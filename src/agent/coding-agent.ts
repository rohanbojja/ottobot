import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { createOpenAI } from "@ai-sdk/openai";
import { codexExec, type CodexExecSettings } from "ai-sdk-provider-codex-cli";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentUIStreamResponse,
  jsonSchema,
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from "ai";
import { CONFIG } from "@/shared/config";
import { createLogger } from "@/shared/logger";
import type { AgentEvent } from "@/application/ports";

const logger = createLogger("coding-agent");
const MCP_PROTOCOL_VERSION = "2025-03-26";
const CODEX_PROVIDER_BUILTIN_TOOL_DESCRIPTIONS = {
  exec: "Provider-executed Codex CLI host shell tool mirror.",
  patch: "Provider-executed Codex CLI host patch tool mirror.",
  web_search: "Provider-executed Codex CLI web search tool mirror.",
  mcp_tool: "Provider-executed Codex CLI MCP fallback tool mirror.",
} as const;
const PROVIDER_EXECUTED_INPUT_SCHEMA = jsonSchema<Record<string, unknown>>({
  type: "object",
  additionalProperties: true,
});
const CODEX_CLI_OPENAI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
] as const;

const AGENT_INSTRUCTIONS = `You are OttoBot, a local coding agent running against a disposable sandbox workspace.
Work through the MCP tools exposed by the sandbox. Prefer small, verifiable changes. Be concise in chat, but keep the user informed about tool work and blockers.

Use the sandbox tools deliberately:
- Inspect code with list_tree, search_files, read_file_range, and read_file before editing.
- Edit with replace_in_file, append_file, write_file, or shell commands inside /home/developer/workspace.
- Run short checks with execute_command. Run dev servers or long-lived watchers with start_process, then read_process for logs and stop_process when done.
- Use browser_navigate, browser_get_state, browser_click/type/fill_form/select_option, browser_take_screenshot, browser_console_messages, and browser_network_requests for web UI work before falling back to coordinate actions.
- Use computer_screenshot and computer_* actions for arbitrary desktop/VNC interaction when structured browser tools are not enough.
- Treat browser state, screenshots, screen state, process logs, and command output as the source of truth for verification.`;

const CODEX_CLI_AGENT_INSTRUCTIONS = `${AGENT_INSTRUCTIONS}

When running through the Codex CLI provider, the local shell is an isolated host scratch directory and is not the sandbox project. Do not use local shell or patch tools to inspect or modify the user's app. Use the ottobot MCP tools for all sandbox file reads, writes, directory listings, dependency installs, and verification commands. Treat /home/developer/workspace as the only writable project workspace. If an MCP tool fails, report that exact failure instead of falling back to host files.`;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateForLog(value: unknown, maxLength = 2000): unknown {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  if (!text) return value;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function removeOpenAIEnvForCodexCliLogin(): string[] {
  const removed: string[] = [];

  for (const key of CODEX_CLI_OPENAI_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      delete process.env[key];
      removed.push(key);
    }
  }

  return removed;
}

const mcpProtocolPinnedFetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set("mcp-protocol-version", MCP_PROTOCOL_VERSION);
    return fetch(input, { ...init, headers });
  },
  { preconnect: fetch.preconnect.bind(fetch) },
);

export class CodingAgent {
  private readonly mcpUrl: string;
  private mcpClient?: MCPClient;
  private agent?: ToolLoopAgent<never, ToolSet>;

  constructor(
    private readonly sessionId: string,
    private readonly emit: (event: AgentEvent) => Promise<void>,
    containerHost: string = "localhost",
    containerPort: number = 8080,
  ) {
    this.mcpUrl = `http://${containerHost}:${containerPort}/mcp`;
  }

  async initialize(_initialPrompt?: string): Promise<void> {
    try {
      logger.info(`Initializing AI SDK agent for session ${this.sessionId}`);
      await this.emitEvent("system", "Initializing AI SDK agent runtime...");
      await this.initializeExecutor();
      await this.emitEvent("system", "Agent initialized and ready");
    } catch (error) {
      logger.error("Agent initialization error:", error);
      await this.emitEvent("error", `Failed to initialize agent: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async streamMessages(
    messages: UIMessage[],
    options: {
      abortSignal?: AbortSignal;
      onFinish?: (messages: UIMessage[]) => Promise<void>;
    } = {},
  ): Promise<Response> {
    const agent = this.requireAgent();

    await this.emitEvent("thinking", "Streaming AI SDK response...", {
      messageCount: messages.length,
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages as never[],
      originalMessages: messages as never,
      abortSignal: options.abortSignal,
      generateMessageId: () => `msg-${crypto.randomUUID()}`,
      onStepFinish: async (step) => {
        await this.emitToolEvents(step.toolCalls, step.toolResults);
        await this.emitEvent("system", `Step ${step.stepNumber + 1} finished`, {
          finishReason: step.finishReason,
          usage: step.usage,
          toolCalls: step.toolCalls.map((toolCall) => toolCall.toolName),
        });
      },
      onFinish: async (event) => {
        await options.onFinish?.(event.messages as UIMessage[]);
        await this.emitEvent("system", "AI SDK stream completed", {
          finishReason: event.finishReason,
          isAborted: event.isAborted,
          totalMessages: event.messages.length,
        });
      },
      onError: (error) => {
        const message = getErrorMessage(error);
        logger.error("AI SDK stream error:", error);
        void this.emitEvent("error", `AI SDK stream error: ${message}`);
        return message;
      },
    });
  }

  async shutdown(): Promise<void> {
    await this.emitEvent("system", "Agent shutting down");
    await this.mcpClient?.close();
    this.mcpClient = undefined;
    this.agent = undefined;
  }

  private async initializeExecutor(): Promise<void> {
    const maxRetries = 30;
    const retryDelay = 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const mcpClient = await createMCPClient({
          transport: {
            type: "http",
            url: this.mcpUrl,
            redirect: "error",
            fetch: mcpProtocolPinnedFetch,
          },
        });
        const tools = this.instrumentTools(await mcpClient.tools());
        this.mcpClient = mcpClient;
        const codexCliProvider = CONFIG.agent.provider === "codex-cli";
        const agentTools = codexCliProvider ? this.createCodexCliToolMirrors(tools) : tools;
        this.agent = new ToolLoopAgent({
          id: `ottobot-${this.sessionId}`,
          model: this.createLanguageModel(),
          instructions: codexCliProvider ? CODEX_CLI_AGENT_INSTRUCTIONS : AGENT_INSTRUCTIONS,
          stopWhen: stepCountIs(CONFIG.agent.maxSteps),
          maxRetries: CONFIG.agent.maxRetries,
          tools: agentTools,
          ...(codexCliProvider ? {} : { temperature: 0.2 }),
          onFinish: async (event) => {
            await this.emitEvent("system", "Agent loop finished", {
              finishReason: event.finishReason,
              steps: event.steps.length,
              totalUsage: event.totalUsage,
            });
          },
        });

        logger.info(`MCP connection established for session ${this.sessionId}`);
        await this.emitEvent("system", "MCP tools connected", {
          toolCount: Object.keys(tools).length,
          provider: CONFIG.agent.provider,
          model: CONFIG.agent.model,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`MCP connection attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);

        if (attempt % 5 === 0) {
          await this.emitEvent(
            "system",
            `Waiting for MCP server to start... (attempt ${attempt}/${maxRetries})`,
          );
        }

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw new Error(`Failed to connect to MCP server after ${maxRetries} attempts: ${lastError?.message ?? "Unknown error"}`);
  }

  private createLanguageModel(): LanguageModel {
    switch (CONFIG.agent.provider) {
      case "anthropic":
        return createAnthropic({ apiKey: CONFIG.agent.anthropicApiKey })(CONFIG.agent.model as never);
      case "google":
        return createGoogleGenerativeAI({ apiKey: CONFIG.agent.geminiApiKey })(CONFIG.agent.model as never);
      case "codex-cli":
        return this.createCodexCliModel();
      case "openai":
        return createOpenAI({ apiKey: CONFIG.agent.openaiApiKey })(CONFIG.agent.model as never);
    }
  }

  private createCodexCliModel(): LanguageModel {
    const removedEnvKeys = removeOpenAIEnvForCodexCliLogin();
    if (removedEnvKeys.length > 0) {
      logger.info("Removed OpenAI environment keys before starting Codex CLI provider", {
        keys: removedEnvKeys,
      });
    }

    const codexCliCwd = this.resolveCodexCliCwd();

    logger.info("Using Codex CLI provider", {
      model: CONFIG.agent.model,
      authMode: "codex-login",
      codexCliPath: CONFIG.agent.codexCliPath || "bundled/global codex",
      codexCliCwd,
    });

    const settings: CodexExecSettings = {
      allowNpx: true,
      approvalMode: "never",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      color: "never",
      mcpServers: {
        ottobot: {
          transport: "http",
          url: this.mcpUrl,
          httpHeaders: {
            "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          },
        },
      },
      configOverrides: {
        "mcp_servers.ottobot.default_tools_approval_mode": "approve",
      },
      ...(CONFIG.agent.codexCliPath ? { codexPath: CONFIG.agent.codexCliPath } : {}),
      cwd: codexCliCwd,
    };

    return codexExec(CONFIG.agent.model, settings) as LanguageModel;
  }

  private resolveCodexCliCwd(): string {
    if (CONFIG.agent.codexCliCwd) {
      return CONFIG.agent.codexCliCwd;
    }

    const cwd = join(tmpdir(), "ottobot-codex-cli", this.sessionId);
    mkdirSync(cwd, { recursive: true });
    return cwd;
  }

  private createCodexCliToolMirrors(tools: ToolSet): ToolSet {
    const mirrors: ToolSet = {};

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      mirrors[toolName] = {
        description: toolDefinition.description,
        title: toolDefinition.title,
        inputSchema: toolDefinition.inputSchema,
        inputExamples: toolDefinition.inputExamples,
        metadata: toolDefinition.metadata,
        providerOptions: toolDefinition.providerOptions,
      };
    }

    for (const [toolName, description] of Object.entries(CODEX_PROVIDER_BUILTIN_TOOL_DESCRIPTIONS)) {
      mirrors[toolName] = {
        description,
        inputSchema: PROVIDER_EXECUTED_INPUT_SCHEMA,
      };
    }

    return mirrors;
  }

  private instrumentTools(tools: ToolSet): ToolSet {
    const instrumented: Record<string, ToolSet[string]> = {};

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      const executableTool = toolDefinition as ToolSet[string] & {
        execute?: (...args: unknown[]) => unknown | Promise<unknown>;
      };

      if (typeof executableTool.execute !== "function") {
        instrumented[toolName] = toolDefinition;
        continue;
      }

      instrumented[toolName] = {
        ...toolDefinition,
        execute: async (...args: unknown[]) => {
          await this.emitEvent("tool_call", `Using ${toolName}...`, {
            toolName,
            input: truncateForLog(args[0]),
          });

          try {
            const output = await executableTool.execute?.(...args);
            await this.emitEvent("tool_result", `${toolName} completed`, {
              toolName,
              output: truncateForLog(output),
            });
            return output;
          } catch (error) {
            await this.emitEvent("error", `${toolName} failed: ${getErrorMessage(error)}`, {
              toolName,
            });
            throw error;
          }
        },
      } as ToolSet[string];
    }

    return instrumented;
  }

  private async emitToolEvents(
    toolCalls: Array<{ toolName: string }>,
    toolResults: Array<{ toolName: string; output?: unknown }>,
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      await this.emitEvent("tool_call", `Using ${toolCall.toolName}...`, {
        toolName: toolCall.toolName,
      });
    }

    for (const toolResult of toolResults) {
      await this.emitEvent("tool_result", `${toolResult.toolName} completed`, {
        toolName: toolResult.toolName,
        output: truncateForLog(toolResult.output),
      });
    }
  }

  private requireAgent(): ToolLoopAgent<never, ToolSet> {
    if (!this.agent) {
      throw new Error("Agent is not initialized");
    }

    return this.agent;
  }

  private async emitEvent(
    type: AgentEvent["type"],
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({ type, content, ...(metadata ? { metadata } : {}) });
  }
}
