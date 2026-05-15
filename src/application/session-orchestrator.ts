import { SessionRouter } from "@/shared/session-router";
import { createLogger } from "@/shared/logger";
import type {
  AgentEvent,
  AgentRuntime,
  AgentRuntimeFactory,
  OrchestrationContext,
  SandboxBackend,
  SessionJob,
  SessionOrchestrator,
  SessionStorePort,
  WorkspaceManager,
} from "@/application/ports";
import type { ChatMessage } from "@/shared/types";

type CreateSessionJob = Extract<SessionJob, { type: "create_session" }>;
type TerminateSessionJob = Extract<SessionJob, { type: "terminate_session" }>;
type ProcessMessageJob = Extract<SessionJob, { type: "process_message" }>;

const logger = createLogger("session-orchestrator");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SessionOrchestratorDeps {
  sessionStore: SessionStorePort;
  workspaceManager: WorkspaceManager;
  sandboxBackend: SandboxBackend;
  agentRuntimeFactory: AgentRuntimeFactory;
}

export class DefaultSessionOrchestrator implements SessionOrchestrator {
  private readonly activeAgents = new Map<string, AgentRuntime>();

  constructor(private readonly deps: SessionOrchestratorDeps) {}

  async createSession(job: CreateSessionJob, context: OrchestrationContext = {}): Promise<void> {
    const { sessionId, data } = job;
    const { initialPrompt, environment, vncPort } = data;
    let mcpPort: number | null = null;
    let sandboxId: string | null = null;

    try {
      await context.updateProgress?.(10);
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Creating session workspace...");
      const workspace = await this.deps.workspaceManager.createWorkspace({ sessionId });

      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Allocating MCP port...");

      mcpPort = await this.deps.sessionStore.allocateMcpPort();
      if (!mcpPort) {
        throw new Error("No available MCP ports");
      }

      await this.deps.sessionStore.addSessionLog(
        sessionId,
        "info",
        `Allocated MCP port ${mcpPort}, creating sandbox...`,
      );

      const sandbox = await this.deps.sandboxBackend.createSandbox({
        sessionId,
        environment,
        vncPort,
        mcpPort,
        workspace,
      });
      sandboxId = sandbox.id;

      await context.updateProgress?.(30);
      await this.deps.sessionStore.updateSession(sessionId, {
        containerId: sandbox.id,
        mcpPort,
        vncPort,
        metadata: {
          sandbox: {
            id: sandbox.id,
            backend: sandbox.backend,
            workspace: sandbox.workspace,
          },
        },
      });
      await this.deps.sessionStore.addSessionLog(sessionId, "info", `Starting ${sandbox.backend} sandbox...`);

      await this.deps.sandboxBackend.startSandbox(sandbox.id);

      await context.updateProgress?.(50);
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Waiting for sandbox desktop to be ready...");

      await this.deps.sandboxBackend.waitForReady(sandbox.id, { vncPort, mcpPort });

      await context.updateProgress?.(70);
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Starting AI agent...");
      await this.deps.sessionStore.updateSessionStatus(sessionId, "ready");
      await this.startAgent(sessionId, sandbox.id, initialPrompt, mcpPort);

      await context.updateProgress?.(90);
      await this.deps.sessionStore.updateSessionStatus(sessionId, "ready");
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Session ready");

      await SessionRouter.publish(sessionId, {
        type: "system_update",
        content: "Session is ready. You can start chatting!",
        timestamp: Date.now(),
        metadata: {
          vnc_ready: true,
        },
      });

      await context.updateProgress?.(100);
      logger.info(`Session ${sessionId} created successfully`);
    } catch (error) {
      logger.error(`Failed to create session ${sessionId}:`, error);
      const errorMessage = getErrorMessage(error);
      await this.recordStartupFailure(sessionId, errorMessage, {
        environment,
        vncPort,
        mcpPort,
        error,
      });

      try {
        const session = await this.deps.sessionStore.getSession(sessionId);
        const sandboxIdForCleanup = session?.containerId ?? sandboxId;

        if (sandboxIdForCleanup) {
          await this.captureSandboxLogs(sessionId, sandboxIdForCleanup);

          try {
            await this.deps.sandboxBackend.stopSandbox(sandboxIdForCleanup);
            await this.deps.sandboxBackend.destroySandbox(sandboxIdForCleanup);
            await this.deps.sessionStore.addSessionLog(
              sessionId,
              "info",
              "Cleaned up sandbox after startup failure",
              { sandboxId: sandboxIdForCleanup },
            );
          } catch (sandboxError) {
            logger.warn("Sandbox cleanup failed during error handling:", sandboxError);
            await this.deps.sessionStore.addSessionLog(
              sessionId,
              "warn",
              `Sandbox cleanup failed after startup failure: ${getErrorMessage(sandboxError)}`,
              { sandboxId: sandboxIdForCleanup },
            );
          }
        }

        await this.releasePorts(vncPort, mcpPort);
        await this.deps.sessionStore.updateSession(sessionId, {
          containerId: undefined,
          vncUrl: undefined,
          vncPort: undefined,
          mcpPort: undefined,
        });
        await this.deps.sessionStore.addSessionLog(
          sessionId,
          "info",
          "Released allocated ports and cleared runtime handles after startup failure",
          { vncPort, mcpPort },
        );
      } catch (cleanupError) {
        logger.error(`Cleanup failed for session ${sessionId}:`, cleanupError);
        await this.recordStartupFailure(
          sessionId,
          `Cleanup failed after startup failure: ${getErrorMessage(cleanupError)}`,
          { vncPort, mcpPort, error: cleanupError },
        );
      }

      throw error;
    }
  }

  async terminateSession(job: TerminateSessionJob, context: OrchestrationContext = {}): Promise<void> {
    const { sessionId, data } = job;
    const { containerId, vncPort, mcpPort } = data;

    try {
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Terminating session...");

      const agent = this.activeAgents.get(sessionId);
      if (agent) {
        await agent.shutdown();
        this.activeAgents.delete(sessionId);
      }

      await context.updateProgress?.(30);

      if (containerId) {
        try {
          await this.deps.sandboxBackend.stopSandbox(containerId);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await this.deps.sandboxBackend.destroySandbox(containerId);
        } catch (error) {
          logger.warn(`Sandbox cleanup failed for ${containerId}, attempting force removal:`, error);
          try {
            await this.deps.sandboxBackend.destroySandbox(containerId);
          } catch (forceError) {
            logger.error("Force sandbox removal failed:", forceError);
          }
        }
      }

      await context.updateProgress?.(70);
      await this.releasePorts(vncPort, mcpPort ?? null);
      await this.deps.sessionStore.updateSessionStatus(sessionId, "terminated");

      await context.updateProgress?.(90);
      setTimeout(() => {
        void this.deps.sessionStore.deleteSession(sessionId);
      }, 300000);

      await context.updateProgress?.(100);
      logger.info(`Session ${sessionId} terminated successfully`);
    } catch (error) {
      logger.error(`Failed to terminate session ${sessionId}:`, error);
      throw error;
    }
  }

  async processMessage(job: ProcessMessageJob): Promise<void> {
    const { sessionId, data } = job;
    const { message } = data;

    try {
      const session = await this.deps.sessionStore.getSession(sessionId);
      if (!session) {
        throw new Error("Session not found");
      }

      let agent = this.activeAgents.get(sessionId);
      if (!agent) {
        logger.warn(`Agent not found for session ${sessionId}, attempting to start agent...`);

        if (!session.containerId || !session.mcpPort) {
          throw new Error("Cannot start agent: session missing sandbox or MCP port");
        }

        const sandboxRunning = await this.deps.sandboxBackend.isSandboxRunning(session.containerId);
        if (!sandboxRunning) {
          throw new Error("Cannot start agent: sandbox is not running");
        }

        try {
          await this.deps.sessionStore.addSessionLog(sessionId, "info", "Recovering agent...");
          await this.startAgent(sessionId, session.containerId, session.initialPrompt, session.mcpPort);
          agent = this.activeAgents.get(sessionId);

          if (!agent) {
            throw new Error("Failed to start agent");
          }

          await this.deps.sessionStore.addSessionLog(sessionId, "info", "Agent recovered successfully");
          await SessionRouter.publish(sessionId, {
            type: "system_update",
            content: "Agent connection restored. You can continue chatting.",
            timestamp: Date.now(),
          });

          logger.info(`Successfully recovered agent for session ${sessionId}`);
        } catch (agentError) {
          logger.error(`Failed to recover agent for session ${sessionId}:`, agentError);
          throw new Error(`Agent recovery failed: ${agentError instanceof Error ? agentError.message : String(agentError)}`);
        }
      }

      await SessionRouter.publish(sessionId, {
        type: "user_prompt",
        content: message.content,
        timestamp: Date.now(),
      });

      await agent.processMessage(message.content);
      logger.info(`Processed message for session ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to process message for session ${sessionId}:`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      await SessionRouter.publish(sessionId, {
        type: "error",
        content: `Failed to process message: ${errorMessage}`,
        timestamp: Date.now(),
      });

      throw error;
    }
  }

  async handleJobFailure(sessionId: string, error: Error): Promise<void> {
    await this.deps.sessionStore.updateSessionStatus(sessionId, "error", error.message);
    await this.deps.sessionStore.addSessionLog(sessionId, "error", `Job failed: ${error.message}`);
  }

  async cleanup(): Promise<void> {
    logger.info("Cleaning up active sessions...");

    for (const [sessionId, agent] of this.activeAgents) {
      try {
        await agent.shutdown();
        await this.deps.sessionStore.updateSessionStatus(sessionId, "terminated");
      } catch (error) {
        logger.error(`Failed to cleanup session ${sessionId}:`, error);
      }
    }

    this.activeAgents.clear();
  }

  private async recordStartupFailure(
    sessionId: string,
    message: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    const metadata = { ...context };
    const rawError = metadata["error"];

    if (rawError instanceof Error) {
      metadata["errorName"] = rawError.name;
      metadata["errorStack"] = rawError.stack ?? "";
      delete metadata["error"];
    } else if (rawError !== undefined) {
      metadata["error"] = getErrorMessage(rawError);
    }

    try {
      await this.deps.sessionStore.updateSessionStatus(sessionId, "error", message);
    } catch (statusError) {
      logger.error(`Failed to mark session ${sessionId} as error:`, statusError);
    }

    try {
      await this.deps.sessionStore.addSessionLog(
        sessionId,
        "error",
        `Session startup failed: ${message}`,
        metadata,
      );
    } catch (logError) {
      logger.error(`Failed to write startup failure log for session ${sessionId}:`, logError);
    }

    try {
      await SessionRouter.publish(sessionId, {
        type: "error",
        content: `Session startup failed: ${message}`,
        timestamp: Date.now(),
      });
    } catch (publishError) {
      logger.warn(`Failed to publish startup failure for session ${sessionId}:`, publishError);
    }
  }

  private async captureSandboxLogs(sessionId: string, sandboxId: string): Promise<void> {
    try {
      const sandboxLogs = (await this.deps.sandboxBackend.getSandboxLogs(sandboxId, 200)).trim();
      if (!sandboxLogs) {
        return;
      }

      const maxLogChars = 12000;
      const capturedLogs =
        sandboxLogs.length > maxLogChars ? sandboxLogs.slice(-maxLogChars) : sandboxLogs;

      await this.deps.sessionStore.addSessionLog(
        sessionId,
        "error",
        "Captured sandbox logs after startup failure",
        {
          sandboxId,
          logs: capturedLogs,
          truncated: sandboxLogs.length > maxLogChars,
        },
      );
    } catch (error) {
      logger.warn(`Failed to capture sandbox logs for ${sandboxId}:`, error);

      try {
        await this.deps.sessionStore.addSessionLog(
          sessionId,
          "warn",
          `Failed to capture sandbox logs after startup failure: ${getErrorMessage(error)}`,
          { sandboxId },
        );
      } catch (logError) {
        logger.error(`Failed to write sandbox log capture failure for session ${sessionId}:`, logError);
      }
    }
  }

  private async startAgent(sessionId: string, sandboxId: string, initialPrompt: string, mcpPort: number): Promise<void> {
    logger.info(`Starting agent for session ${sessionId} (sandbox: ${sandboxId}) with MCP port ${mcpPort}`);

    const agent = this.deps.agentRuntimeFactory.create({
      sessionId,
      mcpHost: "localhost",
      mcpPort,
      emit: async (event) => {
        const message = this.toChatMessage(event);
        await SessionRouter.publish(sessionId, message);
        await this.deps.sessionStore.addSessionMessage(sessionId, message);
      },
    });

    this.activeAgents.set(sessionId, agent);
    await agent.initialize(initialPrompt);
  }

  private async releasePorts(vncPort?: number, mcpPort?: number | null): Promise<void> {
    if (vncPort) {
      await this.deps.sessionStore.releaseVncPort(vncPort);
    }

    if (mcpPort) {
      await this.deps.sessionStore.releaseMcpPort(mcpPort);
    }
  }

  private toChatMessage(event: AgentEvent): ChatMessage {
    const timestamp = Date.now();

    switch (event.type) {
      case "thinking":
        return { type: "agent_thinking", content: event.content, timestamp, metadata: event.metadata as ChatMessage["metadata"] };
      case "response":
        return { type: "agent_response", content: event.content, timestamp, metadata: event.metadata as ChatMessage["metadata"] };
      case "tool_call":
      case "tool_result":
        const metadata = {
          ...event.metadata,
          ...(event.toolName ? { tool_used: event.toolName } : {}),
        } as ChatMessage["metadata"];
        return { type: "agent_action", content: event.content, timestamp, metadata };
      case "system":
        return { type: "system_update", content: event.content, timestamp, metadata: event.metadata as ChatMessage["metadata"] };
      case "error":
        return { type: "error", content: event.content, timestamp, metadata: event.metadata as ChatMessage["metadata"] };
    }
  }
}
