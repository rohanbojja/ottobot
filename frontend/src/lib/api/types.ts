// Generated types from OttoBot API

export type SessionStatus = 'initializing' | 'ready' | 'running' | 'terminating' | 'terminated' | 'error';

export type Environment = 'node' | 'python' | 'full-stack' | 'data-science';

export interface CreateSessionRequest {
  initial_prompt: string;
  timeout?: number;
  environment?: Environment;
}

export interface SessionResponse {
  session_id: string;
  status: SessionStatus;
  vnc_url: string;
  chat_url: string;
  created_at: string;
  expires_at: string;
  initial_prompt?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

export interface MetricsResponse {
  active_sessions: number;
  total_sessions: number;
  queue_length: number;
  uptime: number;
}

export interface SessionLogsResponse {
  logs: Array<{
    timestamp: string;
    level: string;
    message: string;
  }>;
}