import { AiSdkAgentRuntimeFactory } from "@/application/adapters/ai-sdk-agent-runtime";
import { ScratchWorkspaceManager } from "@/application/adapters/scratch-workspace-manager";
import { SqliteSessionStore } from "@/application/adapters/sqlite-session-store";
import { DefaultSessionOrchestrator } from "@/application/session-orchestrator";
import { createSandboxBackend } from "@/application/sandbox-backend-factory";

export const localSessionOrchestrator = new DefaultSessionOrchestrator({
  sessionStore: new SqliteSessionStore(),
  workspaceManager: new ScratchWorkspaceManager(),
  runtimeBackend: createSandboxBackend(),
  agentRuntimeFactory: new AiSdkAgentRuntimeFactory(),
});
