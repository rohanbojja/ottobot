export type SessionStatus = 'initializing' | 'ready' | 'running' | 'terminating' | 'terminated' | 'error';

export interface Session {
  id: string;
  status: SessionStatus;
  initialPrompt: string;
  containerId?: string;
  vncUrl?: string;
  vncPort?: number;
  mcpPort?: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionRequest {
  initial_prompt: string;
  timeout?: number;
  environment?: 'node' | 'python' | 'full-stack' | 'data-science';
}

export interface SessionResponse {
  session_id: string;
  status: SessionStatus;
  vnc_url: string;
  chat_endpoint: string;
  created_at: string;
  expires_at: string;
  initial_prompt: string;
}

export interface ChatMessage {
  type: 'user_prompt' | 'agent_response' | 'agent_thinking' | 'agent_action' | 'system_update' | 'download_ready' | 'error';
  content: string;
  timestamp: number;
  metadata?: {
    tool_used?: string;
    progress?: number;
    download_url?: string;
    error?: string;
    vnc_ready?: boolean;
    [key: string]: unknown;
  };
}

export type SessionCommand =
  | {
      type: 'create_session';
      sessionId: string;
      data: {
        initialPrompt: string;
        environment: NonNullable<CreateSessionRequest['environment']> | string;
        vncPort: number;
      };
    }
  | {
      type: 'terminate_session';
      sessionId: string;
      data: {
        containerId?: string;
        vncPort?: number;
        mcpPort?: number;
      };
    };

export interface ContainerConfig {
  image: string;
  name: string;
  memory: string;
  cpus: number;
  vncPort: number;
  environment: Record<string, string>;
  volumes?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentState {
  sessionId: string;
  conversation: ChatMessage[];
  currentTask?: string;
  workingDirectory: string;
  files: Map<string, string>;
  environment: Record<string, string>;
  context: {
    recentMessages: ChatMessage[];
    summary?: string;
    tokenCount: number;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  services: {
    docker: boolean;
    registry: boolean;
    sessions: number;
  };
  agent: {
    provider: string;
    model: string;
  };
}

export interface Metrics {
  activeSessions: number;
  totalSessions: number;
}
