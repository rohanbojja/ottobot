import type { UIMessage } from "ai";
import type { Session, SessionCommand, SessionStatus } from "@/shared/types";

export type SessionJob = SessionCommand;

export type AgentEvent =
  | { type: "thinking"; content: string; metadata?: Record<string, unknown> }
  | { type: "tool_call"; content: string; toolName?: string; metadata?: Record<string, unknown> }
  | { type: "tool_result"; content: string; toolName?: string; metadata?: Record<string, unknown> }
  | { type: "system"; content: string; metadata?: Record<string, unknown> }
  | { type: "error"; content: string; metadata?: Record<string, unknown> };

export interface AgentRuntime {
  initialize(initialPrompt?: string): Promise<void>;
  streamMessages(
    messages: UIMessage[],
    options?: {
      abortSignal?: AbortSignal;
      onFinish?: (messages: UIMessage[]) => Promise<void>;
    },
  ): Promise<Response>;
  shutdown(): Promise<void>;
}

export interface AgentRuntimeFactory {
  create(input: {
    sessionId: string;
    mcpHost: string;
    mcpPort: number;
    emit: (event: AgentEvent) => Promise<void>;
  }): AgentRuntime;
}

export type WorkspaceSession = {
  sessionId: string;
  mode: "scratch" | "git-worktree";
  hostPath: string;
  sandboxPath: string;
  sourceRepoPath?: string;
  branchName?: string;
};

export interface WorkspaceManager {
  createWorkspace(input: {
    sessionId: string;
    sourceRepoPath?: string;
    branchName?: string;
  }): Promise<WorkspaceSession>;
}

export type SandboxInstance = {
  id: string;
  backend: string;
  workspace: WorkspaceSession;
};

export interface SandboxBackend {
  createSandbox(input: {
    sessionId: string;
    environment: string;
    vncPort: number;
    mcpPort: number;
    workspace: WorkspaceSession;
  }): Promise<SandboxInstance>;
  startSandbox(sandboxId: string): Promise<void>;
  stopSandbox(sandboxId: string): Promise<void>;
  destroySandbox(sandboxId: string): Promise<void>;
  isSandboxRunning(sandboxId: string): Promise<boolean>;
  waitForReady(sandboxId: string, input: { vncPort: number; mcpPort: number }): Promise<void>;
  getSandboxLogs(sandboxId: string, tail?: number): Promise<string>;
}

export interface SessionStorePort {
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  updateSessionStatus(sessionId: string, status: SessionStatus, error?: string): Promise<void>;
  addSessionLog(
    sessionId: string,
    level: "info" | "warn" | "error" | "debug",
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  upsertSessionUIMessages(sessionId: string, messages: UIMessage[]): Promise<void>;
  getSessionUIMessages(sessionId: string): Promise<UIMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
  allocateVncPort(): Promise<number | null>;
  releaseVncPort(port: number): Promise<void>;
  allocateMcpPort(): Promise<number | null>;
  releaseMcpPort(port: number): Promise<void>;
}

export interface SessionOrchestrator {
  createSession(job: Extract<SessionJob, { type: "create_session" }>, context?: OrchestrationContext): Promise<void>;
  streamMessages(sessionId: string, messages: UIMessage[], abortSignal?: AbortSignal): Promise<Response>;
  terminateSession(job: Extract<SessionJob, { type: "terminate_session" }>, context?: OrchestrationContext): Promise<void>;
}

export interface OrchestrationContext {
  updateProgress?: (progress: number) => Promise<void>;
}

export interface ToolServer {
  registerTools(): void;
  listen(port: number): void;
  shutdown(): Promise<void>;
}

// TODO: Add a WorktreeManager that creates per-session git worktrees before
// sandbox startup. The backend contract should stay independent from the
// current Docker implementation.
// TODO: Consider Firecracker VM isolation after SandboxBackend owns all
// lifecycle and cleanup behavior behind this interface.
