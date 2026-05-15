const API_BASE = import.meta.env.VITE_OTTOBOT_API_URL ?? "http://127.0.0.1:3000";

export type SessionStatus =
  | "initializing"
  | "ready"
  | "running"
  | "terminating"
  | "terminated"
  | "error";

export type SessionSummary = {
  session_id: string;
  status: SessionStatus;
  vnc_url: string;
  chat_url: string;
  created_at: string;
  expires_at: string;
  initial_prompt: string;
};

export type ListSessionsResponse = {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type HealthResponse = {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  services: {
    docker: boolean;
    registry: boolean;
    sessions: number;
  };
  timestamp: string;
};

export type MetricsResponse = {
  active_sessions: number;
  total_sessions: number;
  timestamp: string;
};

export type SessionLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type SessionLogsResponse = {
  session_id: string;
  logs: SessionLogEntry[];
};

export type ChatMessageWire = {
  type:
    | "user_prompt"
    | "agent_response"
    | "agent_thinking"
    | "agent_action"
    | "system_update"
    | "download_ready"
    | "error";
  content?: string;
  error?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("OttoBot API is offline. Start the local API from Settings or run bun run dev:api.");
    }

    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }

  return response.json() as Promise<T>;
}

export const ottobotApi = {
  baseUrl: API_BASE,
  health: () => apiFetch<HealthResponse>("/health"),
  metrics: () => apiFetch<MetricsResponse>("/health/metrics"),
  listSessions: () => apiFetch<ListSessionsResponse>("/session?limit=30"),
  getSession: (id: string) => apiFetch<SessionSummary>(`/session/${id}`),
  getSessionLogs: (id: string, limit = 60) =>
    apiFetch<SessionLogsResponse>(`/session/${id}/logs?limit=${encodeURIComponent(String(limit))}`),
  createSession: (initialPrompt: string) =>
    apiFetch<SessionSummary>("/session", {
      method: "POST",
      body: JSON.stringify({
        initial_prompt: initialPrompt,
        environment: "node",
      }),
    }),
  deleteSession: (id: string) =>
    apiFetch<{ message: string; session_id: string }>(`/session/${id}`, {
      method: "DELETE",
    }),
  downloadUrl: (id: string) => `${API_BASE}/download/${id}`,
};

export function statusTone(status: SessionStatus | string) {
  if (status === "ready" || status === "running") return "positive";
  if (status === "initializing" || status === "terminating") return "warning";
  if (status === "error") return "negative";
  return "neutral";
}
