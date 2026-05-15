import { DockerSandboxBackend } from "@/application/adapters/docker-sandbox-backend";
import { LangGraphAgentRuntimeFactory } from "@/application/adapters/langgraph-agent-runtime";
import { ScratchWorkspaceManager } from "@/application/adapters/scratch-workspace-manager";
import { SqliteSessionStore } from "@/application/adapters/sqlite-session-store";
import { DefaultSessionOrchestrator } from "@/application/session-orchestrator";

export const localSessionOrchestrator = new DefaultSessionOrchestrator({
  sessionStore: new SqliteSessionStore(),
  workspaceManager: new ScratchWorkspaceManager(),
  sandboxBackend: new DockerSandboxBackend(),
  agentRuntimeFactory: new LangGraphAgentRuntimeFactory(),
});
