import { createLogger } from "@/shared/logger";
import { sanitizeUIMessages } from "@/shared/ui-messages";
import type { UIMessage } from "ai";
import type {
  AgentRuntime,
  AgentRuntimeFactory,
  OrchestrationContext,
  SandboxBackend,
  SessionJob,
  SessionOrchestrator,
  SessionStorePort,
  WorkspaceManager,
} from "@/application/ports";

type CreateSessionJob = Extract<SessionJob, { type: "create_session" }>;
type TerminateSessionJob = Extract<SessionJob, { type: "terminate_session" }>;

const logger = createLogger("session-orchestrator");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SessionOrchestratorDeps {
  sessionStore: SessionStorePort;
  workspaceManager: WorkspaceManager;
  runtimeBackend: SandboxBackend;
  agentRuntimeFactory: AgentRuntimeFactory;
}

export class DefaultSessionOrchestrator implements SessionOrchestrator {
  private readonly activeAgents = new Map<string, AgentRuntime>();

  constructor(private readonly deps: SessionOrchestratorDeps) {}

  async createSession(job: CreateSessionJob, context: OrchestrationContext = {}): Promise<void> {
    const { sessionId, data } = job;
    const { environment, vncPort } = data;
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

      const runtime = await this.deps.runtimeBackend.createSandbox({
        sessionId,
        environment,
        vncPort,
        mcpPort,
        workspace,
      });
      sandboxId = runtime.id;

      await context.updateProgress?.(30);
      await this.deps.sessionStore.updateSession(sessionId, {
        containerId: runtime.id,
        mcpPort,
        vncPort,
        metadata: {
          sandbox: {
            id: runtime.id,
            backend: runtime.backend,
            workspace: runtime.workspace,
          },
        },
      });
      await this.deps.sessionStore.addSessionLog(
        sessionId,
        "info",
        `Starting ${runtime.backend} session backend...`,
      );

      await this.deps.runtimeBackend.startSandbox(runtime.id);

      await context.updateProgress?.(50);
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Waiting for sandbox desktop to be ready...");

      await this.deps.runtimeBackend.waitForReady(runtime.id, { vncPort, mcpPort });

      await context.updateProgress?.(70);
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Starting AI agent...");
      await this.startAgent(sessionId, runtime.id, mcpPort);

      await context.updateProgress?.(90);
      await this.deps.sessionStore.updateSessionStatus(sessionId, "ready");
      await this.deps.sessionStore.addSessionLog(sessionId, "info", "Session ready");

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
            await this.deps.runtimeBackend.stopSandbox(sandboxIdForCleanup);
            await this.deps.runtimeBackend.destroySandbox(sandboxIdForCleanup);
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
          await this.deps.runtimeBackend.stopSandbox(containerId);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await this.deps.runtimeBackend.destroySandbox(containerId);
        } catch (error) {
          logger.warn(`Sandbox cleanup failed for ${containerId}, attempting force removal:`, error);
          try {
            await this.deps.runtimeBackend.destroySandbox(containerId);
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

  async streamMessages(
    sessionId: string,
    messages: UIMessage[],
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    const session = await this.deps.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const agent = await this.ensureAgent(sessionId, session);
    const sanitizedMessages = sanitizeUIMessages(messages);
    await this.deps.sessionStore.upsertSessionUIMessages(sessionId, sanitizedMessages);

    return agent.streamMessages(sanitizedMessages, {
      abortSignal,
      onFinish: async (nextMessages) => {
        const sanitizedNextMessages = sanitizeUIMessages(nextMessages);
        await this.deps.sessionStore.upsertSessionUIMessages(sessionId, sanitizedNextMessages);
        await this.deps.sessionStore.addSessionLog(sessionId, "info", "Persisted AI SDK UI messages", {
          messageCount: sanitizedNextMessages.length,
        });
      },
    });
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
  }

  private async captureSandboxLogs(sessionId: string, sandboxId: string): Promise<void> {
    try {
      const sandboxLogs = (await this.deps.runtimeBackend.getSandboxLogs(sandboxId, 200)).trim();
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

  private async ensureAgent(sessionId: string, session: NonNullable<Awaited<ReturnType<SessionStorePort["getSession"]>>>): Promise<AgentRuntime> {
    const activeAgent = this.activeAgents.get(sessionId);
    if (activeAgent) {
      return activeAgent;
    }

    if (!session.containerId || !session.mcpPort) {
      throw new Error("Cannot start agent: session missing sandbox or MCP port");
    }

    const sandboxRunning = await this.deps.runtimeBackend.isSandboxRunning(session.containerId);
    if (!sandboxRunning) {
      throw new Error("Cannot start agent: sandbox is not running");
    }

    await this.deps.sessionStore.addSessionLog(sessionId, "info", "Recovering AI SDK agent...");
    await this.startAgent(sessionId, session.containerId, session.mcpPort);
    const recoveredAgent = this.activeAgents.get(sessionId);

    if (!recoveredAgent) {
      throw new Error("Failed to start agent");
    }

    await this.deps.sessionStore.addSessionLog(sessionId, "info", "Agent recovered successfully");
    return recoveredAgent;
  }

  private async startAgent(sessionId: string, sandboxId: string, mcpPort: number): Promise<void> {
    logger.info(`Starting agent for session ${sessionId} (sandbox: ${sandboxId}) with MCP port ${mcpPort}`);

    const agent = this.deps.agentRuntimeFactory.create({
      sessionId,
      mcpHost: "localhost",
      mcpPort,
      emit: async (event) => {
        await this.deps.sessionStore.addSessionLog(
          sessionId,
          event.type === "error" ? "error" : "info",
          event.content,
          event.metadata,
        );
      },
    });

    await agent.initialize();
    this.activeAgents.set(sessionId, agent);
  }

  private async releasePorts(vncPort?: number, mcpPort?: number | null): Promise<void> {
    if (vncPort) {
      await this.deps.sessionStore.releaseVncPort(vncPort);
    }

    if (mcpPort) {
      await this.deps.sessionStore.releaseMcpPort(mcpPort);
    }
  }

}
