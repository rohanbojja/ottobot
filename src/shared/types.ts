export type SessionStatus = 'initializing' | 'ready' | 'running' | 'terminating' | 'terminated' | 'error';

export interface Session {
  id: string;
  status: SessionStatus;
  initialPrompt: string;
  containerId?: string;
  vncUrl?: string;
  vncPort?: number;
  workerId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  error?: string;
  metadata?: Record<string, any>;
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
  chat_url: string;
  created_at: string;
  expires_at: string;
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
  };
}

export interface WorkerJob {
  type: 'create_session' | 'terminate_session' | 'process_message';
  sessionId: string;
  data: any;
}

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
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
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
    redis: boolean;
    docker: boolean;
    workers: number;
  };
}

export interface Metrics {
  activeSessions: number;
  totalSessions: number;
  queueLength: number;
  workerStatus: Array<{
    id: string;
    active: boolean;
    currentJobs: number;
  }>;
}