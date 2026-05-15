import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";

import TopDeskTabs from "@/components/TopDeskTabs";
import {
  deskHeaderClass,
  deskIconControlPillClass,
  deskRailSurfaceClass,
  deskShellClass,
  deskSolidSurfaceClass,
  getToneBadgeClass,
  type Tone,
} from "@/components/desk-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ottobotApi,
  statusTone,
  type ChatMessageWire,
  type HealthResponse,
  type MetricsResponse,
  type SessionLogEntry,
  type SessionSummary,
} from "@/lib/ottobot-api";
import {
  checkLocalRuntime,
  DEFAULT_AGENT_IMAGE,
  getRuntimeSettings,
  hasTauriRuntime,
  saveRuntimeSettings,
  startLocalService,
  stopLocalService,
  startWindowDrag,
  type LocalServiceName,
  type ManagedServiceStatus,
  type RuntimeSettings,
  type RuntimeStatus,
} from "@/lib/tauri-runtime";
import { cn } from "@/lib/utils";

type RouteId = "sessions" | "settings";
type ChatMessage = {
  id: string;
  role: "user" | "agent" | "system" | "action" | "error" | "thinking";
  label: string;
  content: string;
  timestamp: number;
};
type SocketState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

type CreateFlowState = "idle" | "warming" | "creating" | "ready" | "error";
type WarmupStepStatus = "pending" | "active" | "done" | "error";
type WarmupStepId = "docker" | "agentImage" | "api" | "session";
type WarmupStep = {
  id: WarmupStepId;
  label: string;
  detail: string;
  status: WarmupStepStatus;
};
type CreateFlow = {
  state: CreateFlowState;
  title: string;
  detail: string;
  steps: WarmupStep[];
};

const navItems = [
  { id: "sessions", label: "Sessions", shortcutLabel: "Cmd+1" },
  { id: "settings", label: "Settings", shortcutLabel: "Cmd+2" },
] satisfies Array<{ id: RouteId; label: string; shortcutLabel: string }>;

const CREATE_STEPS: WarmupStep[] = [
  { id: "docker", label: "Docker", detail: "Checking local sandbox runtime", status: "pending" },
  { id: "agentImage", label: "Agent image", detail: "Checking sandbox image", status: "pending" },
  { id: "api", label: "API", detail: "Preparing HTTP and WebSocket server", status: "pending" },
  { id: "session", label: "Session", detail: "Booting container and agent", status: "pending" },
];

const IDLE_CREATE_FLOW: CreateFlow = {
  state: "idle",
  title: "Ready",
  detail: "Create starts the local runtime if needed.",
  steps: CREATE_STEPS,
};
const LOG_REFRESH_INTERVAL_MS = 12_000;
const SOCKET_RECONNECT_BASE_MS = 750;
const SOCKET_RECONNECT_MAX_MS = 12_000;
const GET_STARTED_PROMPTS = [
  "Build a small TypeScript app",
  "Fix a UI alignment issue",
  "Add a Tauri command",
  "Create a focused React screen",
];

function freshCreateSteps() {
  return CREATE_STEPS.map((step) => ({ ...step }));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toneForService(service?: ManagedServiceStatus | null): Tone {
  if (!service) return "neutral";
  if (service.state === "running") return "positive";
  if (service.state === "error") return "negative";
  if (service.state === "unknown") return "warning";
  return "neutral";
}

function StatusPill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("h-6", getToneBadgeClass(tone))}>
      {children}
    </Badge>
  );
}

function formatTime(value?: string | number | null) {
  if (!value) return "never";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatusText(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "unknown";
}

function vncClientUrl(rawUrl: string, resize: "scale" | "remote" = "scale") {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("autoconnect", "true");
    url.searchParams.set("reconnect", "true");
    url.searchParams.set("resize", resize);
    url.searchParams.set("show_dot", "true");
    return url.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}autoconnect=true&reconnect=true&resize=${resize}&show_dot=true`;
  }
}

function sessionAcceptsSocket(status: SessionSummary["status"]) {
  return status === "ready" || status === "running";
}

function socketStateTone(state: SocketState): Tone {
  if (state === "connected") return "positive";
  if (state === "connecting" || state === "reconnecting") return "warning";
  if (state === "error") return "negative";
  return "neutral";
}

function logLevelTone(level: string): Tone {
  const normalized = level.toLowerCase();
  if (normalized.includes("error") || normalized.includes("fatal")) return "negative";
  if (normalized.includes("warn")) return "warning";
  if (normalized.includes("debug") || normalized.includes("trace")) return "neutral";
  return "info";
}

function messageDedupKey(message: ChatMessageWire) {
  if (message.type === "system_update" && message.content === "Connected to session") {
    return JSON.stringify([message.type, message.content]);
  }

  return JSON.stringify([
    message.type,
    message.timestamp,
    message.content ?? "",
    message.error ?? "",
  ]);
}

function messageFromWire(message: ChatMessageWire): ChatMessage {
  const content = message.content ?? message.error ?? "No message content";
  const id = `${message.type}-${message.timestamp}-${content.slice(0, 24)}`;

  switch (message.type) {
    case "user_prompt":
      return { id, role: "user", label: "You", content, timestamp: message.timestamp };
    case "agent_response":
      return { id, role: "agent", label: "OttoBot", content, timestamp: message.timestamp };
    case "agent_action":
      return { id, role: "action", label: "Action", content, timestamp: message.timestamp };
    case "agent_thinking":
      return { id, role: "thinking", label: "Thinking", content, timestamp: message.timestamp };
    case "error":
      return { id, role: "error", label: "Error", content, timestamp: message.timestamp };
    default:
      return { id, role: "system", label: "System", content, timestamp: message.timestamp };
  }
}

function messageClass(role: ChatMessage["role"]) {
  if (role === "user") return "ml-auto border-sky-400/20 bg-sky-400/10";
  if (role === "agent") return "border-emerald-400/20 bg-emerald-400/10";
  if (role === "action") return "border-violet-400/20 bg-violet-400/10 font-mono";
  if (role === "thinking") return "border-amber-400/20 bg-amber-400/10";
  if (role === "error") return "border-rose-400/25 bg-rose-400/10 text-rose-100";
  return "mx-auto border-white/10 bg-white/[0.04] text-center";
}

export default function App() {
  const isTauri = hasTauriRuntime();
  const [currentRoute, setCurrentRoute] = useState<RouteId>("sessions");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("Help me build a small TypeScript app.");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [createFlow, setCreateFlow] = useState<CreateFlow>(() => ({
    ...IDLE_CREATE_FLOW,
    steps: freshCreateSteps(),
  }));
  const [apiError, setApiError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<SocketState>("idle");
  const [sessionLogs, setSessionLogs] = useState<SessionLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsUpdatedAt, setLogsUpdatedAt] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const seenMessages = useRef<Set<string>>(new Set());
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const selectedSessionIdRef = useRef<string | null>(null);
  const logsRequestInFlightRef = useRef<string | null>(null);
  selectedSessionIdRef.current = selectedSessionId;

  const selectedSession = useMemo(
    () => sessions.find((session) => session.session_id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const selectedSessionAcceptsSocket = selectedSession ? sessionAcceptsSocket(selectedSession.status) : false;

  const refreshRuntime = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    setRuntime(await checkLocalRuntime());
  }, []);

  const refreshApi = useCallback(async () => {
    try {
      const [nextHealth, nextMetrics, nextSessions] = await Promise.all([
        ottobotApi.health(),
        ottobotApi.metrics(),
        ottobotApi.listSessions(),
      ]);
      setHealth(nextHealth);
      setMetrics(nextMetrics);
      setSessions(nextSessions.sessions);
      setApiError(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    setRuntimeSettings(await getRuntimeSettings());
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refreshRuntime(), refreshApi(), refreshSettings()]);
  }, [refreshApi, refreshRuntime, refreshSettings]);

  const refreshSessionLogs = useCallback(async (showLoading = true) => {
    const sessionId = selectedSessionIdRef.current;
    if (!sessionId) {
      setSessionLogs([]);
      setLogsError(null);
      setLogsUpdatedAt(null);
      setLogsLoading(false);
      return;
    }

    if (logsRequestInFlightRef.current === sessionId) return;
    logsRequestInFlightRef.current = sessionId;
    if (showLoading) setLogsLoading(true);

    try {
      const response = await ottobotApi.getSessionLogs(sessionId, 60);
      if (selectedSessionIdRef.current !== sessionId) return;
      setSessionLogs(response.logs);
      setLogsError(null);
      setLogsUpdatedAt(Date.now());
    } catch (error) {
      if (selectedSessionIdRef.current !== sessionId) return;
      setLogsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (logsRequestInFlightRef.current === sessionId) {
        logsRequestInFlightRef.current = null;
      }
      if (selectedSessionIdRef.current === sessionId) setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("native-glass-window");
    void refreshAll();
    const interval = window.setInterval(() => void refreshAll(), 6000);
    return () => window.clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const route = navItems[index]?.id;
      if (route) {
        event.preventDefault();
        setCurrentRoute(route);
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    seenMessages.current.clear();
    setMessages([]);
  }, [selectedSession?.session_id]);

  useEffect(() => {
    setSessionLogs([]);
    setLogsError(null);
    setLogsUpdatedAt(null);
    setLogsLoading(Boolean(selectedSessionId));

    if (!selectedSessionId) {
      setLogsLoading(false);
      return;
    }

    void refreshSessionLogs(true);
    const interval = window.setInterval(() => void refreshSessionLogs(false), LOG_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshSessionLogs, selectedSessionId]);

  useEffect(() => {
    if (!selectedSession || createFlow.state !== "creating") return;

    if (selectedSession.status === "ready" || selectedSession.status === "running") {
      setCreateFlow((current) => ({
        ...current,
        state: "ready",
        title: "Session ready",
        detail: "The sandbox and local agent are ready.",
        steps: current.steps.map((step) =>
          step.id === "session" ? { ...step, status: "done", detail: "Session ready" } : step,
        ),
      }));
      return;
    }

    if (selectedSession.status === "error") {
      setCreateFlow((current) => ({
        ...current,
        state: "error",
        title: "Create failed",
        detail: "Session startup failed. Open diagnostics for the captured logs.",
        steps: current.steps.map((step) =>
          step.id === "session" ? { ...step, status: "error", detail: "Startup failed" } : step,
        ),
      }));
    }
  }, [createFlow.state, selectedSession]);

  useEffect(() => {
    let active = true;
    let currentSocket: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current === null) return;
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const appendSocketMessage = (data: string) => {
      try {
        const wireMessage = JSON.parse(data) as ChatMessageWire;
        const dedupKey = messageDedupKey(wireMessage);
        if (seenMessages.current.has(dedupKey)) return;
        seenMessages.current.add(dedupKey);
        setMessages((current) => [...current, messageFromWire(wireMessage)]);
      } catch (error) {
        const timestamp = Date.now();
        setMessages((current) => [
          ...current,
          {
            id: `parse-${timestamp}`,
            role: "error",
            label: "Parse error",
            content: error instanceof Error ? error.message : String(error),
            timestamp,
          },
        ]);
      }
    };

    const scheduleReconnect = (connect: () => void) => {
      if (!active) return;
      if (reconnectTimerRef.current !== null) return;

      const attempt = Math.min(reconnectAttemptRef.current + 1, 8);
      reconnectAttemptRef.current = attempt;
      const delayMs = Math.min(
        SOCKET_RECONNECT_BASE_MS * 2 ** (attempt - 1),
        SOCKET_RECONNECT_MAX_MS,
      );

      setSocketState("reconnecting");
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delayMs);
    };

    if (!selectedSession || !selectedSessionAcceptsSocket) {
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setSocketState("idle");
      return;
    }

    const connect = () => {
      if (!active) return;
      setSocketState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      let socket: WebSocket;
      try {
        socket = new WebSocket(selectedSession.chat_url);
      } catch (error) {
        setSocketState("error");
        scheduleReconnect(connect);
        return;
      }

      currentSocket = socket;
      socketRef.current = socket;

      socket.onopen = () => {
        if (!active || socketRef.current !== socket) return;
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        setSocketState("connected");
      };

      socket.onerror = () => {
        if (!active || socketRef.current !== socket) return;
        setSocketState("error");
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      };

      socket.onclose = () => {
        if (!active || socketRef.current !== socket) return;
        socketRef.current = null;
        scheduleReconnect(connect);
      };

      socket.onmessage = (event) => appendSocketMessage(String(event.data));
    };

    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      active = false;
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      if (socketRef.current === currentSocket) socketRef.current = null;
      if (currentSocket && currentSocket.readyState !== WebSocket.CLOSED) {
        currentSocket.close(1000, "component cleanup");
      }
    };
  }, [selectedSession?.chat_url, selectedSession?.session_id, selectedSessionAcceptsSocket]);

  async function runServiceAction(service: LocalServiceName, action: "start" | "stop") {
    setBusyAction(`${action}-${service}`);
    try {
      if (!hasTauriRuntime()) throw new Error("Run inside Tauri to control local services.");
      if (action === "start") await startLocalService(service);
      else await stopLocalService(service);
      if (action === "start" && service === "api") await waitForApiReady();
      await refreshAll();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function updateRuntimeSettings(nextSettings: RuntimeSettings) {
    setBusyAction("save-runtime-settings");
    try {
      if (!hasTauriRuntime()) throw new Error("Run inside Tauri to save runtime settings.");
      const saved = await saveRuntimeSettings(nextSettings);
      setRuntimeSettings(saved);
      setApiError(null);
      await refreshRuntime();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  function handleChromeMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (!isTauri || event.button !== 0) return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button,a,input,textarea,select,[role='button'],[data-no-window-drag='true'],[data-tauri-drag-region='false']")
    ) {
      return;
    }

    event.preventDefault();
    void startWindowDrag();
  }

  function updateWarmupStep(id: WarmupStepId, status: WarmupStepStatus, detail?: string) {
    setCreateFlow((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
      ),
    }));
  }

  async function waitForRuntime(
    predicate: (nextRuntime: RuntimeStatus) => boolean,
    timeoutMs = 25_000,
  ): Promise<RuntimeStatus> {
    const deadline = Date.now() + timeoutMs;
    let lastRuntime = await checkLocalRuntime();
    setRuntime(lastRuntime);

    while (!predicate(lastRuntime) && Date.now() < deadline) {
      await delay(700);
      lastRuntime = await checkLocalRuntime();
      setRuntime(lastRuntime);
    }

    if (!predicate(lastRuntime)) {
      throw new Error("Runtime did not become ready in time.");
    }

    return lastRuntime;
  }

  async function waitForApiReady(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const nextHealth = await ottobotApi.health();
        const nextMetrics = await ottobotApi.metrics().catch(() => null);
        setHealth(nextHealth);
        if (nextMetrics) setMetrics(nextMetrics);
        return nextHealth;
      } catch (error) {
        lastError = error;
        await delay(800);
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : "OttoBot API did not become ready in time.");
  }

  async function prepareRuntimeForCreate() {
    setCreateFlow({
      state: "warming",
      title: "Warming local runtime",
      detail: "Checking Docker, image, and API before creating the session.",
      steps: freshCreateSteps(),
    });

    if (!isTauri) {
      updateWarmupStep("docker", "done", "Browser preview cannot inspect Docker");
      updateWarmupStep("agentImage", "done", "Browser preview cannot manage the agent image");
      updateWarmupStep("api", "active", "Waiting for API");
      await waitForApiReady();
      updateWarmupStep("api", "done", "API is reachable");
      return;
    }

    let nextRuntime = await checkLocalRuntime();
    setRuntime(nextRuntime);

    if (nextRuntime.docker.state !== "running") {
      updateWarmupStep("docker", "error", "Docker Desktop is not running");
      throw new Error("Docker Desktop must be running before OttoBot can create a session.");
    }
    updateWarmupStep("docker", "done", "Docker is reachable");

    updateWarmupStep("agentImage", "active", "Checking first-run sandbox image");
    if (nextRuntime.agentImage.state !== "running") {
      updateWarmupStep("agentImage", "active", "Building first-run sandbox image. Docker can take a few minutes.");
      await startLocalService("agentImage");
      nextRuntime = await waitForRuntime((runtimeStatus) => runtimeStatus.agentImage.state === "running", 120_000);
    }
    updateWarmupStep("agentImage", "done", "Agent image is available");

    updateWarmupStep("api", "active", "Starting API if needed");
    if (nextRuntime.api.state !== "running") {
      updateWarmupStep("api", "active", "Starting local API process");
      await startLocalService("api");
    }
    await waitForApiReady();
    updateWarmupStep("api", "done", "API is reachable");
  }

  async function createSession() {
    setBusyAction("create-session");
    try {
      setApiError(null);
      await prepareRuntimeForCreate();
      updateWarmupStep("session", "active", "Booting sandbox");
      setCreateFlow((current) => ({
        ...current,
        state: "creating",
        title: "Creating session",
        detail: "Requesting a new sandbox session from the local API.",
      }));
      const session = await ottobotApi.createSession(prompt.trim() || "Help me build a web application.");
      setSelectedSessionId(session.session_id);
      setCurrentRoute("sessions");
      await refreshApi();
      setCreateFlow((current) => ({
        ...current,
        state: "creating",
        title: "Session starting",
        detail: "The API accepted the session. Docker startup is continuing in the background.",
        steps: current.steps.map((step) =>
          step.id === "session"
            ? { ...step, status: "active", detail: "Session accepted; sandbox is starting" }
            : step,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiError(message);
      setCreateFlow((current) => ({
        ...current,
        state: "error",
        title: "Create failed",
        detail: message,
      }));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSelectedSession() {
    if (!selectedSession) return;
    setBusyAction("delete-session");
    try {
      await ottobotApi.deleteSession(selectedSession.session_id);
      setSelectedSessionId(null);
      await refreshApi();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  function sendMessage() {
    if (!draft.trim() || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: "user_prompt",
        content: draft.trim(),
        timestamp: Date.now(),
      }),
    );
    setDraft("");
  }

  const sessionSidebar = (
    <SidebarGroup>
      <SidebarGroupLabel data-sidebar-collapsed="hide">Sessions</SidebarGroupLabel>
      <SidebarGroupContent>
        {sessions.length === 0 ? (
          <div
            data-sidebar-collapsed="hide"
            className="mx-2 rounded-lg border border-dashed border-sidebar-border p-3 text-xs leading-5 text-sidebar-foreground/65"
          >
            No sessions yet. Start from a prompt and the session will appear here while it warms.
          </div>
        ) : (
          <SidebarMenu className="gap-1">
            {sessions.map((session) => (
              <SidebarMenuItem key={session.session_id}>
                <SidebarMenuButton
                  size="lg"
                  isActive={selectedSession?.session_id === session.session_id}
                  onClick={() => {
                    setSelectedSessionId(session.session_id);
                    setCurrentRoute("sessions");
                  }}
                  tooltip={session.initial_prompt || "Coding session"}
                  className="h-auto min-h-14 items-start gap-2 px-2 py-2"
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate text-[0.9rem] leading-5">
                      {session.initial_prompt || "Coding session"}
                    </span>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[0.7rem] text-sidebar-foreground/55">
                        {formatTime(session.created_at)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium capitalize leading-none",
                          getToneBadgeClass(statusTone(session.status) as Tone),
                        )}
                      >
                        {session.status}
                      </span>
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <TooltipProvider>
      <div className="dark flex h-full min-h-0 flex-col overflow-hidden text-foreground native-glass-root">
        <div className={cn("min-h-0 flex-1 overflow-hidden", isTauri ? "p-0" : "p-2", deskShellClass)}>
        <SidebarProvider defaultOpen>
          <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar/70">
            <SidebarHeader
              data-tauri-drag-region=""
              data-sidebar-collapsed="header"
              onMouseDown={handleChromeMouseDown}
              className="gap-3 pt-2"
            >
              <div data-sidebar-collapsed="hide" className="flex h-7 min-w-0 -translate-y-0.5 items-center gap-2 pl-[var(--chrome-titlebar-safe-left)]">
                <Bot className="h-4 w-4 text-primary" />
                <span className="truncate text-sm font-semibold">OttoBot</span>
              </div>
              <Button
                data-sidebar-collapsed="icon-button"
                className="w-full justify-start"
                data-no-window-drag="true"
                disabled={busyAction === "create-session"}
                onClick={() => {
                  setCurrentRoute("sessions");
                  setSelectedSessionId(null);
                  window.setTimeout(() => document.getElementById("new-session-prompt")?.focus(), 0);
                }}
              >
                <Plus />
                <span data-sidebar-collapsed="hide">New session</span>
              </Button>
            </SidebarHeader>
            <SidebarContent>{sessionSidebar}</SidebarContent>
            <SidebarFooter>
              <SidebarSeparator />
              <div data-sidebar-collapsed="hide" className="grid gap-2 px-2 pb-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sidebar-foreground/70">API</span>
                  <StatusPill tone={toneForService(runtime?.api)}>{runtime?.api.state ?? "unknown"}</StatusPill>
                </div>
              </div>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset className="min-h-0 bg-transparent">
            <header
              className={cn(
                deskHeaderClass,
                "grid h-[var(--chrome-header-height)] select-none grid-cols-[minmax(11rem,1fr)_minmax(18rem,34rem)_minmax(11rem,1fr)] items-center gap-3 px-3",
              )}
              data-tauri-drag-region=""
              onMouseDown={handleChromeMouseDown}
            >
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className={deskIconControlPillClass} data-tauri-drag-region="false" />
                <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
                  <Zap className="h-3.5 w-3.5" />
                  <span>Local coding agent</span>
                </div>
              </div>
              <div className="min-w-0 px-2">
                <TopDeskTabs items={navItems} activeId={currentRoute} onSelect={setCurrentRoute} className="w-full" />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="icon" variant="ghost" className={deskIconControlPillClass} data-tauri-drag-region="false" onClick={() => void refreshAll()}>
                  <RefreshCw />
                </Button>
              </div>
            </header>

            <main className="min-h-0 flex-1 overflow-hidden p-3">
              <div className="flex h-full min-h-0 flex-col gap-3">
                {apiError ? (
                  <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{apiError}</span>
                  </div>
                ) : null}

                {currentRoute === "settings" ? (
                  <SettingsView
                    runtime={runtime}
                    health={health}
                    metrics={metrics}
                    runtimeSettings={runtimeSettings}
                    saveSettings={updateRuntimeSettings}
                    refreshSettings={refreshSettings}
                    runServiceAction={runServiceAction}
                    busyAction={busyAction}
                    isTauri={isTauri}
                  />
                ) : (
                  <SessionsWorkspace
                    health={health}
                    metrics={metrics}
                    runtime={runtime}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    createSession={createSession}
                    busyCreate={busyAction === "create-session"}
                    createFlow={createFlow}
                    session={selectedSession}
                    messages={messages}
                    socketState={socketState}
                    sessionLogs={sessionLogs}
                    logsError={logsError}
                    logsLoading={logsLoading}
                    logsUpdatedAt={logsUpdatedAt}
                    refreshLogs={() => void refreshSessionLogs(true)}
                    draft={draft}
                    setDraft={setDraft}
                    sendMessage={sendMessage}
                    deleteSession={deleteSelectedSession}
                    busyDelete={busyAction === "delete-session"}
                  />
                )}
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SessionsWorkspace({
  health,
  metrics,
  runtime,
  prompt,
  setPrompt,
  createSession,
  busyCreate,
  createFlow,
  session,
  messages,
  socketState,
  sessionLogs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
  draft,
  setDraft,
  sendMessage,
  deleteSession,
  busyDelete,
}: {
  health: HealthResponse | null;
  metrics: MetricsResponse | null;
  runtime: RuntimeStatus | null;
  prompt: string;
  setPrompt: (value: string) => void;
  createSession: () => void;
  busyCreate: boolean;
  createFlow: CreateFlow;
  session: SessionSummary | null;
  messages: ChatMessage[];
  socketState: SocketState;
  sessionLogs: SessionLogEntry[];
  logsError: string | null;
  logsLoading: boolean;
  logsUpdatedAt: number | null;
  refreshLogs: () => void;
  draft: string;
  setDraft: (value: string) => void;
  sendMessage: () => void;
  deleteSession: () => void;
  busyDelete: boolean;
}) {
  if (!session) {
    return (
      <NewSessionView
        health={health}
        metrics={metrics}
        runtime={runtime}
        prompt={prompt}
        setPrompt={setPrompt}
        createSession={createSession}
        busy={busyCreate}
        createFlow={createFlow}
      />
    );
  }

  return (
    <div className="grid h-full min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(32rem,1.05fr)]">
      <div className="min-h-0 min-w-0 overflow-y-auto">
        <SessionChatView
          session={session}
          messages={messages}
          socketState={socketState}
          draft={draft}
          setDraft={setDraft}
          sendMessage={sendMessage}
        />
      </div>
      <SessionArtifactView
        session={session}
        socketState={socketState}
        logs={sessionLogs}
        logsError={logsError}
        logsLoading={logsLoading}
        logsUpdatedAt={logsUpdatedAt}
        refreshLogs={refreshLogs}
        deleteSession={deleteSession}
        busyDelete={busyDelete}
      />
    </div>
  );
}

function NewSessionView({
  health,
  metrics,
  runtime,
  prompt,
  setPrompt,
  createSession,
  busy,
  createFlow,
}: {
  health: HealthResponse | null;
  metrics: MetricsResponse | null;
  runtime: RuntimeStatus | null;
  prompt: string;
  setPrompt: (value: string) => void;
  createSession: () => void;
  busy: boolean;
  createFlow: CreateFlow;
}) {
  const runtimeItems = [
    { label: "API", value: runtime?.api.state ?? health?.status ?? "offline", icon: Terminal, tone: toneForService(runtime?.api) },
    {
      label: "Registry",
      value: health?.services.registry ? "ready" : "unknown",
      icon: Boxes,
      tone: health?.services.registry ? "positive" as Tone : "neutral" as Tone,
    },
    { label: "Docker", value: runtime?.docker.state ?? "unknown", icon: Monitor, tone: toneForService(runtime?.docker) },
    { label: "Sessions", value: String(metrics?.active_sessions ?? 0), icon: Activity, tone: "info" as Tone },
  ];
  const showWarmup = createFlow.state !== "idle";

  return (
    <div className="flex h-full min-h-[36rem] items-center justify-center overflow-y-auto px-4 py-10">
      <div className="grid w-full max-w-5xl gap-6">
        <div className="mx-auto grid max-w-3xl justify-items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-[1.35rem] border border-primary/20 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <Bot className="h-8 w-8" />
          </div>
          <div className="grid gap-2">
            <h1 className="text-4xl font-semibold leading-tight tracking-normal md:text-5xl">
              Get started with OttoBot
            </h1>
            <p className="text-base text-muted-foreground md:text-lg">
              What should your local coding agent build?
            </p>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-4xl gap-3">
          <form
            className="rounded-[1.6rem] border border-border bg-background/35 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void createSession();
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground">
                <Plus className="h-5 w-5" />
              </div>
              <Input
                id="new-session-prompt"
                value={prompt}
                disabled={busy}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    if (!busy) void createSession();
                  }
                }}
                placeholder="Describe the app, bug, or change..."
                className="h-12 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent md:text-lg"
              />
              <StatusPill tone={toneForService(runtime?.api)}>
                {formatStatusText(runtime?.api.state ?? health?.status)}
              </StatusPill>
              <Button
                type="submit"
                size="icon-lg"
                aria-label="Start session"
                disabled={busy}
                className="h-11 w-11 rounded-full"
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap justify-center gap-2">
            {GET_STARTED_PROMPTS.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="rounded-full bg-background/25 px-3 text-muted-foreground hover:text-foreground"
                onClick={() => setPrompt(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>

        {showWarmup ? (
          <div className="mx-auto w-full max-w-4xl">
            <WarmupProgress flow={createFlow} />
          </div>
        ) : null}

        <div className="mx-auto grid w-full max-w-4xl gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {runtimeItems.map(({ label, value, icon: Icon, tone }) => (
            <div
              key={label}
              className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-background/20 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
              <span className="shrink-0 text-sm font-medium capitalize text-foreground">
                {formatStatusText(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WarmupProgress({ flow }: { flow: CreateFlow }) {
  if (flow.state === "idle") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/25 px-3 py-2 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{flow.detail}</span>
      </div>
    );
  }

  const tone = flow.state === "error" ? "negative" : flow.state === "ready" ? "positive" : "warning";

  return (
    <div className="rounded-lg border border-border bg-background/30 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{flow.title}</p>
          <p className="text-xs leading-5 text-muted-foreground">{flow.detail}</p>
        </div>
        <StatusPill tone={tone}>{flow.state}</StatusPill>
      </div>
      <div className="grid gap-2">
        {flow.steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 text-xs">
            {step.status === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            ) : step.status === "active" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
            ) : step.status === "error" ? (
              <CircleAlert className="h-3.5 w-3.5 text-rose-300" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
            <span className="w-24 font-medium">{step.label}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{step.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BROWSER_RUNTIME_SETTINGS_PREVIEW: RuntimeSettings = {
  useDefaultAgentImage: true,
  agentImage: DEFAULT_AGENT_IMAGE,
  updatedAtMs: 0,
};

function resolveSettingsAgentImage(settings: RuntimeSettings) {
  return settings.useDefaultAgentImage
    ? DEFAULT_AGENT_IMAGE
    : settings.agentImage.trim() || DEFAULT_AGENT_IMAGE;
}

function SettingsView({
  runtime,
  health,
  metrics,
  runtimeSettings,
  saveSettings,
  refreshSettings,
  runServiceAction,
  busyAction,
  isTauri,
}: {
  runtime: RuntimeStatus | null;
  health: HealthResponse | null;
  metrics: MetricsResponse | null;
  runtimeSettings: RuntimeSettings | null;
  saveSettings: (settings: RuntimeSettings) => Promise<void>;
  refreshSettings: () => Promise<void>;
  runServiceAction: (service: LocalServiceName, action: "start" | "stop") => Promise<void>;
  busyAction: string | null;
  isTauri: boolean;
}) {
  const [draftSettings, setDraftSettings] = useState<RuntimeSettings | null>(runtimeSettings);

  useEffect(() => {
    setDraftSettings(runtimeSettings);
  }, [runtimeSettings]);

  const effectiveSettings = draftSettings ?? (!isTauri ? BROWSER_RUNTIME_SETTINGS_PREVIEW : null);

  if (!effectiveSettings) {
    return (
      <Card className={deskSolidSurfaceClass}>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading runtime settings...
        </CardContent>
      </Card>
    );
  }

  const resolvedImage = resolveSettingsAgentImage(effectiveSettings);
  const saveBusy = busyAction === "save-runtime-settings";
  const imageBuildBusy = busyAction === "start-agentImage";
  const externalApiRunning = runtime?.api.state === "running" && !runtime.api.managed;
  const serviceCards = [runtime?.api, runtime?.docker, runtime?.agentImage].filter(Boolean) as ManagedServiceStatus[];

  const updateDraft = (patch: Partial<RuntimeSettings>) => {
    setDraftSettings((current) => ({
      ...(current ?? BROWSER_RUNTIME_SETTINGS_PREVIEW),
      ...patch,
    }));
  };

  const resetDraft = () => {
    setDraftSettings({
      useDefaultAgentImage: true,
      agentImage: DEFAULT_AGENT_IMAGE,
      updatedAtMs: effectiveSettings.updatedAtMs,
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid gap-4">
        <Card className={cn(deskSolidSurfaceClass, "border-primary/15")}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-primary" />
                  Settings
                </CardTitle>
                <CardDescription>Local runtime settings for the desktop-managed API and Docker sandbox image.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 rounded-lg border border-border bg-background/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Docker Agent Image</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    This image is checked, built, and passed as AGENT_IMAGE when the desktop starts the API.
                  </p>
                </div>
                <StatusPill tone={toneForService(runtime?.agentImage)}>{runtime?.agentImage.state ?? "unknown"}</StatusPill>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-border bg-background/30 p-3">
                <Checkbox
                  id="use-default-agent-image"
                  checked={effectiveSettings.useDefaultAgentImage}
                  disabled={!isTauri}
                  onCheckedChange={(checked) => updateDraft({ useDefaultAgentImage: checked === true })}
                />
                <Label htmlFor="use-default-agent-image" className="leading-5">
                  Use default image
                  <span className="block text-xs font-normal text-muted-foreground">{DEFAULT_AGENT_IMAGE}</span>
                </Label>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="grid gap-2">
                  <Label htmlFor="agent-image">Image override</Label>
                  <Input
                    id="agent-image"
                    value={effectiveSettings.agentImage}
                    disabled={!isTauri || effectiveSettings.useDefaultAgentImage}
                    onChange={(event) => updateDraft({ agentImage: event.target.value })}
                    placeholder={DEFAULT_AGENT_IMAGE}
                    className="bg-background/45"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="resolved-agent-image">Resolved image</Label>
                  <Input id="resolved-agent-image" readOnly value={resolvedImage} className="bg-background/45" />
                </div>
              </div>

              {externalApiRunning ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>The API is reachable but was not started by this desktop window, so this UI cannot guarantee which AGENT_IMAGE it is using.</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" disabled={!isTauri || imageBuildBusy} onClick={() => void runServiceAction("agentImage", "start")}>
                  {imageBuildBusy ? <Loader2 className="animate-spin" /> : <Boxes />}
                  Build image
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" disabled={!isTauri} onClick={resetDraft}>
                    Reset
                  </Button>
                  <Button disabled={!isTauri || saveBusy} onClick={() => void saveSettings(effectiveSettings)}>
                    {saveBusy ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={deskSolidSurfaceClass}>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
            <CardDescription>Docker stays external. The desktop can supervise the local API when launched from here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              {serviceCards.map((service) => (
                <div key={service.key} className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{service.label}</p>
                    <StatusPill tone={toneForService(service)}>{service.state}</StatusPill>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{service.detail}</p>
                  {service.key === "api" ? (
                    <div className="mt-3 flex gap-2">
                      <Button size="xs" variant="outline" disabled={!isTauri || busyAction === "start-api"} onClick={() => void runServiceAction("api", "start")}>
                        <Play />
                        Start
                      </Button>
                      <Button size="xs" variant="ghost" disabled={!isTauri || busyAction === "stop-api"} onClick={() => void runServiceAction("api", "stop")}>
                        <Square />
                        Stop
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <Separator />
            <div className="grid gap-2 text-sm">
              <p>API health: {health?.status ?? "offline"}</p>
              <p>Total sessions: {metrics?.total_sessions ?? 0}</p>
              <p>SQLite registry: {health?.services.registry ? "ready" : "unknown"}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/25 p-3 text-xs text-muted-foreground">
              <span>Last saved: {effectiveSettings.updatedAtMs ? formatTime(effectiveSettings.updatedAtMs) : "not saved"}</span>
              <Button size="sm" variant="ghost" disabled={!isTauri} onClick={() => void refreshSettings()}>
                <RefreshCw />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SessionChatView({
  session,
  messages,
  socketState,
  draft,
  setDraft,
  sendMessage,
}: {
  session: SessionSummary;
  messages: ChatMessage[];
  socketState: SocketState;
  draft: string;
  setDraft: (value: string) => void;
  sendMessage: () => void;
}) {
  const ready = session.status === "ready" || session.status === "running";

  return (
    <Card className={cn(deskSolidSurfaceClass, "flex h-full min-h-[32rem] flex-col overflow-hidden")}>
      <CardHeader className="shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{session.initial_prompt || "Coding session"}</CardTitle>
            <CardDescription>
              {session.session_id} · {socketState} · {formatTime(session.created_at)}
            </CardDescription>
          </div>
          <StatusPill tone={statusTone(session.status) as Tone}>{session.status}</StatusPill>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {!ready ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Warming sandbox, VNC, MCP tools, and agent runtime.</span>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-background/20 p-3">
          <div className={cn("max-w-[84%] rounded-lg border p-3 text-sm", messageClass("user"))}>
            <p className="mb-1 text-xs font-medium text-sky-200">Initial prompt</p>
            <p className="whitespace-pre-wrap">{session.initial_prompt}</p>
          </div>
          {messages.length === 0 ? (
            <div className="grid place-items-center py-12 text-sm text-muted-foreground">
              {ready ? "Waiting for agent messages." : "Session is not ready yet."}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={cn("max-w-[84%] rounded-lg border p-3 text-sm", messageClass(message.role))}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{message.label}</span>
                  <span>{formatTime(message.timestamp)}</span>
                </div>
                <p className="whitespace-pre-wrap leading-6">{message.content}</p>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                sendMessage();
              }
            }}
            disabled={!ready || socketState !== "connected"}
            placeholder="Message OttoBot..."
            className="min-h-16 flex-1 resize-none rounded-lg border border-input bg-background/50 px-3 py-2 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <Button size="icon-lg" disabled={!draft.trim() || !ready || socketState !== "connected"} onClick={sendMessage}>
            <Send />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionArtifactView({
  session,
  socketState,
  logs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
  deleteSession,
  busyDelete,
}: {
  session: SessionSummary | null;
  socketState: SocketState;
  logs: SessionLogEntry[];
  logsError: string | null;
  logsLoading: boolean;
  logsUpdatedAt: number | null;
  refreshLogs: () => void;
  deleteSession: () => void;
  busyDelete: boolean;
}) {
  if (!session) {
    return (
      <Card className={cn(deskRailSurfaceClass, "flex h-full min-h-[32rem] flex-col overflow-hidden")}>
        <CardContent className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Monitor className="h-5 w-5" />
            </div>
            <CardTitle>Desktop appears with a session</CardTitle>
            <CardDescription className="mt-2">
              Create or select a session to inspect the sandbox desktop. Until then, use the prompt to ask OttoBot what to build.
            </CardDescription>
          </div>
        </CardContent>
      </Card>
    );
  }

  const ready = session.status === "ready" || session.status === "running";
  const vncUrl = vncClientUrl(session.vnc_url);

  return (
    <Card className={cn(deskRailSurfaceClass, "flex h-full min-h-[32rem] flex-col overflow-hidden")}>
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>Desktop</CardTitle>
            <CardDescription>{ready ? `Live sandbox · ${socketState}` : "Waiting for sandbox"}</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!ready} asChild>
            <a href={vncUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {ready ? (
          <div className="relative min-h-[18rem] flex-1 overflow-hidden rounded-lg border border-border bg-black">
            <iframe
              title="Sandbox desktop"
              src={vncUrl}
              allow="clipboard-read; clipboard-write"
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : (
          <div className="grid min-h-[18rem] flex-1 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            <div className="text-center">
              <Monitor className="mx-auto mb-2 h-6 w-6" />
              Waiting for VNC.
            </div>
          </div>
        )}
        <SessionDiagnosticsPanel
          session={session}
          ready={ready}
          socketState={socketState}
          vncUrl={vncUrl}
          logs={logs}
          logsError={logsError}
          logsLoading={logsLoading}
          logsUpdatedAt={logsUpdatedAt}
          refreshLogs={refreshLogs}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" disabled={!ready} asChild>
            <a href={ottobotApi.downloadUrl(session.session_id)}>
              <Download />
              Download
            </a>
          </Button>
          <Button variant="destructive" disabled={busyDelete} onClick={deleteSession}>
            {busyDelete ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Terminate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionDiagnosticsPanel({
  session,
  ready,
  socketState,
  vncUrl,
  logs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
}: {
  session: SessionSummary;
  ready: boolean;
  socketState: SocketState;
  vncUrl: string;
  logs: SessionLogEntry[];
  logsError: string | null;
  logsLoading: boolean;
  logsUpdatedAt: number | null;
  refreshLogs: () => void;
}) {
  const visibleLogs = logs.slice(-8);

  return (
    <div className="shrink-0 rounded-lg border border-border bg-background/25 p-3">
      <div className="grid gap-2 text-xs sm:grid-cols-[6.5rem_7.5rem_minmax(0,1fr)]">
        <div className="grid gap-1">
          <span className="text-muted-foreground">Status</span>
          <StatusPill tone={statusTone(session.status) as Tone}>{session.status}</StatusPill>
        </div>
        <div className="grid gap-1">
          <span className="text-muted-foreground">Socket</span>
          <StatusPill tone={socketStateTone(socketState)}>{socketState}</StatusPill>
        </div>
        <div className="grid min-w-0 gap-1">
          <span className="text-muted-foreground">VNC</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
              {session.vnc_url || "not allocated"}
            </span>
            {ready ? (
              <Button size="xs" variant="ghost" asChild>
                <a href={vncUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open
                </a>
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled>
                <ExternalLink />
                Open
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Recent logs</p>
        <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
          <span>{logsUpdatedAt ? `Updated ${formatTime(logsUpdatedAt)}` : "Not loaded"}</span>
          <Button size="icon-xs" variant="ghost" disabled={logsLoading} onClick={refreshLogs}>
            {logsLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {logsError ? (
        <div className="mt-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-2 py-1.5 text-xs text-rose-100">
          {logsError}
        </div>
      ) : null}

      <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-border/70 bg-background/30">
        {visibleLogs.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {logsLoading ? "Loading logs..." : "No logs yet."}
          </div>
        ) : (
          visibleLogs.map((log, index) => (
            <div
              key={`${log.timestamp}-${log.level}-${index}`}
              className="grid grid-cols-[4.5rem_3.25rem_minmax(0,1fr)] items-start gap-2 border-b border-border/50 px-2 py-1.5 font-mono text-[0.68rem] last:border-b-0"
            >
              <span className="text-muted-foreground">{formatTime(log.timestamp)}</span>
              <span className={cn("rounded border px-1 text-center uppercase", getToneBadgeClass(logLevelTone(log.level)))}>
                {log.level}
              </span>
              <span className="min-w-0 truncate text-muted-foreground" title={log.message}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
