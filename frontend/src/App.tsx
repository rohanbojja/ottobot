import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  DefaultChatTransport,
  type ChatStatus,
  type FileUIPart,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationFollowLatest,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInput,
  PromptInputBody,
  PromptInputHeader,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import {
  Activity,
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
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";

import { OttoBotMark } from "@/components/brand";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type HealthResponse,
  type MetricsResponse,
  type SessionLogEntry,
  type SessionSummary,
} from "@/lib/ottobot-api";
import {
  checkLocalRuntime,
  DEFAULT_AGENT_IMAGE,
  getProviderConfig,
  getRuntimeSettings,
  hasTauriRuntime,
  saveProviderConfig,
  saveRuntimeSettings,
  startLocalService,
  stopLocalService,
  startWindowDrag,
  type LocalServiceName,
  type LlmProvider,
  type ManagedServiceStatus,
  type ProviderConfig,
  type RuntimeSettings,
  type RuntimeStatus,
} from "@/lib/tauri-runtime";
import { cn } from "@/lib/utils";

type RouteId = "sessions" | "settings";
type CreateSessionInput = { prompt?: string; files?: FileUIPart[] };
type PendingInitialPrompt = { sessionId: string; prompt: string; files: FileUIPart[] };

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

const routeShortcuts = [
  { id: "sessions", shortcutLabel: "Cmd+1" },
  { id: "settings", shortcutLabel: "Cmd+2" },
] satisfies Array<{ id: RouteId; shortcutLabel: string }>;

const CREATE_STEPS: WarmupStep[] = [
  { id: "docker", label: "Docker", detail: "Checking Docker", status: "pending" },
  { id: "agentImage", label: "Image", detail: "Checking image", status: "pending" },
  { id: "api", label: "API", detail: "Preparing API", status: "pending" },
  { id: "session", label: "Session", detail: "Starting session", status: "pending" },
];

const IDLE_CREATE_FLOW: CreateFlow = {
  state: "idle",
  title: "Ready",
  detail: "Ready.",
  steps: CREATE_STEPS,
};
const LOG_REFRESH_INTERVAL_MS = 12_000;
const GET_STARTED_PROMPTS = [
  "Build a todo app",
  "Make a notes app",
  "Create a landing page",
  "Add a login form",
];
const LLM_PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI", detail: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", detail: "ANTHROPIC_API_KEY" },
  { id: "google", label: "Google Gemini", detail: "GEMINI_API_KEY" },
  { id: "codex-cli", label: "Codex CLI", detail: "codex login" },
] satisfies Array<{ id: LlmProvider; label: string; detail: string }>;
const DEFAULT_PROVIDER_MODELS = {
  openai: "gpt-4.1-nano",
  anthropic: "claude-3-5-haiku-latest",
  google: "gemini-2.5-flash",
  "codex-cli": "gpt-5.5",
} satisfies Record<LlmProvider, string>;

function freshCreateSteps() {
  return CREATE_STEPS.map((step) => ({ ...step }));
}

function defaultModelForProvider(provider: LlmProvider) {
  return DEFAULT_PROVIDER_MODELS[provider];
}

function labelForProvider(provider: LlmProvider | string) {
  return LLM_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? provider;
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

function chatStatusTone(state: ChatStatus | "idle"): Tone {
  if (state === "ready") return "positive";
  if (state === "submitted" || state === "streaming") return "warning";
  if (state === "error") return "negative";
  return "neutral";
}

function composerStatusLabel(status: ChatStatus, ready: boolean) {
  if (!ready) return "Starting session";
  if (status === "submitted" || status === "streaming") return "Sending";
  if (status === "error") return "Needs attention";
  return "Ready to send";
}

function composerStatusTone(status: ChatStatus, ready: boolean): Tone {
  if (!ready) return "warning";
  if (status === "submitted" || status === "streaming") return "warning";
  if (status === "error") return "negative";
  return "positive";
}

function logLevelTone(level: string): Tone {
  const normalized = level.toLowerCase();
  if (normalized.includes("error") || normalized.includes("fatal")) return "negative";
  if (normalized.includes("warn")) return "warning";
  if (normalized.includes("debug") || normalized.includes("trace")) return "neutral";
  return "info";
}

export default function App() {
  const isTauri = hasTauriRuntime();
  const [currentRoute, setCurrentRoute] = useState<RouteId>("sessions");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<PendingInitialPrompt | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("ready");
  const [prompt, setPrompt] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [createFlow, setCreateFlow] = useState<CreateFlow>(() => ({
    ...IDLE_CREATE_FLOW,
    steps: freshCreateSteps(),
  }));
  const [apiError, setApiError] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<SessionLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsUpdatedAt, setLogsUpdatedAt] = useState<number | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const logsRequestInFlightRef = useRef<string | null>(null);
  selectedSessionIdRef.current = selectedSessionId;

  const selectedSession = useMemo(
    () => sessions.find((session) => session.session_id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

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
    const [nextRuntimeSettings, nextProviderConfig] = await Promise.all([
      getRuntimeSettings(),
      getProviderConfig(),
    ]);
    setRuntimeSettings(nextRuntimeSettings);
    setProviderConfig(nextProviderConfig);
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
      const route = routeShortcuts[index]?.id;
      if (route) {
        event.preventDefault();
        setCurrentRoute(route);
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    setChatStatus("ready");
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
        detail: "Ready.",
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
        detail: "Startup failed.",
        steps: current.steps.map((step) =>
          step.id === "session" ? { ...step, status: "error", detail: "Startup failed" } : step,
        ),
      }));
    }
  }, [createFlow.state, selectedSession]);

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

  async function updateProviderConfig(nextConfig: ProviderConfig) {
    setBusyAction("save-provider-config");
    try {
      if (!hasTauriRuntime()) throw new Error("Run inside Tauri to save provider settings.");
      const saved = await saveProviderConfig(nextConfig);
      setProviderConfig(saved);
      setApiError(null);
      await waitForApiReady();
      await refreshAll();
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
      title: "Starting",
      detail: "Checking runtime.",
      steps: freshCreateSteps(),
    });

    if (!isTauri) {
      updateWarmupStep("docker", "done", "Preview mode");
      updateWarmupStep("agentImage", "done", "Preview mode");
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

    updateWarmupStep("agentImage", "active", "Checking image");
    if (nextRuntime.agentImage.state !== "running") {
      updateWarmupStep("agentImage", "active", "Building image. This can take a few minutes.");
      await startLocalService("agentImage");
      nextRuntime = await waitForRuntime((runtimeStatus) => runtimeStatus.agentImage.state === "running", 120_000);
    }
    updateWarmupStep("agentImage", "done", "Image ready");

    updateWarmupStep("api", "active", "Starting API if needed");
    if (nextRuntime.api.state !== "running") {
      updateWarmupStep("api", "active", "Starting local API process");
      await startLocalService("api");
    }
    await waitForApiReady();
    updateWarmupStep("api", "done", "API is reachable");
  }

  async function createSession(input: CreateSessionInput = {}) {
    setBusyAction("create-session");
    try {
      setApiError(null);
      await prepareRuntimeForCreate();
      updateWarmupStep("session", "active", "Starting session");
      setCreateFlow((current) => ({
        ...current,
        state: "creating",
        title: "Starting session",
        detail: "Creating container.",
      }));
      const initialPrompt = (input.prompt ?? prompt).trim() || "Start a new session.";
      const session = await ottobotApi.createSession(initialPrompt);
      setPendingInitialPrompt({
        files: input.files ?? [],
        prompt: initialPrompt,
        sessionId: session.session_id,
      });
      setSelectedSessionId(session.session_id);
      setCurrentRoute("sessions");
      await refreshApi();
      setCreateFlow((current) => ({
        ...current,
        state: "creating",
        title: "Session starting",
        detail: "Container starting.",
        steps: current.steps.map((step) =>
          step.id === "session"
            ? { ...step, status: "active", detail: "Container starting" }
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
      setPendingInitialPrompt(null);
      await refreshApi();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
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
            No sessions yet.
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
                  tooltip={session.initial_prompt || "Session"}
                  className="h-auto min-h-14 items-start gap-2 px-2 py-2"
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate text-[0.9rem] leading-5">
                      {session.initial_prompt || "Session"}
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
                <OttoBotMark className="h-4 w-7 text-sidebar-foreground" />
                <span className="truncate text-sm font-semibold tracking-normal">OttoBot</span>
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
                "grid h-[var(--chrome-header-height)] select-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3",
              )}
              data-tauri-drag-region=""
              onMouseDown={handleChromeMouseDown}
            >
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className={deskIconControlPillClass} data-tauri-drag-region="false" />
              </div>
              <div className="min-w-0" />
              <div className="flex justify-end gap-2" data-tauri-drag-region="false">
                <Button
                  size="icon"
                  variant="ghost"
                  className={deskIconControlPillClass}
                  aria-label="Refresh"
                  title="Refresh"
                  onClick={() => void refreshAll()}
                >
                  <RefreshCw />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className={deskIconControlPillClass}
                  aria-label="Settings"
                  title="Settings"
                  data-active={currentRoute === "settings"}
                  onClick={() => setCurrentRoute("settings")}
                >
                  <Settings />
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
                    providerConfig={providerConfig}
                    saveSettings={updateRuntimeSettings}
                    saveProviderConfig={updateProviderConfig}
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
                    pendingInitialPrompt={pendingInitialPrompt}
                    clearPendingInitialPrompt={(sessionId) => {
                      setPendingInitialPrompt((current) =>
                        current?.sessionId === sessionId ? null : current,
                      );
                    }}
                    chatStatus={chatStatus}
                    onChatStatusChange={setChatStatus}
                    sessionLogs={sessionLogs}
                    logsError={logsError}
                    logsLoading={logsLoading}
                    logsUpdatedAt={logsUpdatedAt}
                    refreshLogs={() => void refreshSessionLogs(true)}
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
  pendingInitialPrompt,
  clearPendingInitialPrompt,
  chatStatus,
  onChatStatusChange,
  sessionLogs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
  deleteSession,
  busyDelete,
}: {
  health: HealthResponse | null;
  metrics: MetricsResponse | null;
  runtime: RuntimeStatus | null;
  prompt: string;
  setPrompt: (value: string) => void;
  createSession: (input?: CreateSessionInput) => void;
  busyCreate: boolean;
  createFlow: CreateFlow;
  session: SessionSummary | null;
  pendingInitialPrompt: PendingInitialPrompt | null;
  clearPendingInitialPrompt: (sessionId: string) => void;
  chatStatus: ChatStatus;
  onChatStatusChange: (status: ChatStatus) => void;
  sessionLogs: SessionLogEntry[];
  logsError: string | null;
  logsLoading: boolean;
  logsUpdatedAt: number | null;
  refreshLogs: () => void;
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
          pendingInitialPrompt={pendingInitialPrompt}
          clearPendingInitialPrompt={clearPendingInitialPrompt}
          onChatStatusChange={onChatStatusChange}
          refreshLogs={refreshLogs}
        />
      </div>
      <SessionArtifactView
        session={session}
        chatStatus={chatStatus}
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
  createSession: (input?: CreateSessionInput) => void;
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
    <div className="new-session-screen">
      <div className="new-session-layout">
        <section className="new-session-primary" aria-labelledby="new-session-title">
          <div className="new-session-header">
            <div className="new-session-mark" aria-hidden="true">
              <OttoBotMark className="h-10 w-16 text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 id="new-session-title" className="new-session-title">
                OttoBot
              </h1>
            </div>
          </div>

          <PromptInput
            className={cn(
              "new-session-composer rounded-2xl border border-border/70 bg-gradient-to-b from-background/80 via-background/55 to-background/30 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.85)] backdrop-blur-xl",
              "[&_[data-slot=input-group]]:overflow-hidden [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-border/70 [&_[data-slot=input-group]]:bg-background/30 [&_[data-slot=input-group]]:shadow-none",
              "[&_[data-slot=input-group-addon]]:bg-transparent"
            )}
            onSubmit={(message) => {
              const nextPrompt = message.text.trim();
              if (nextPrompt) setPrompt(nextPrompt);
              if (!busy) void createSession({ files: message.files, prompt: nextPrompt });
            }}
          >
            <PromptInputHeader className="flex items-center justify-between gap-3 px-4 pt-4 pb-0 text-xs">
              <span className="font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Compose
              </span>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span className={cn("size-2 rounded-full", busy ? "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]" : "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]")} />
                {busy ? "Preparing" : "Ready to send"}
              </span>
            </PromptInputHeader>
            <PromptInputBody>
              <div className="new-session-prompt-row px-4 pt-3">
                <div className="new-session-prompt-icon" aria-hidden="true">
                  <Plus className="h-4 w-4" />
                </div>
                <PromptInputTextarea
                  id="new-session-prompt"
                  value={prompt}
                  disabled={busy}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
                  placeholder="What should OttoBot work on?"
                  className="new-session-textarea min-h-24 border-0 bg-transparent px-0 py-0 text-[0.98rem] leading-6 placeholder:text-muted-foreground/65 focus-visible:ring-0"
                />
              </div>
            </PromptInputBody>
            <PromptInputFooter className="new-session-composer-footer items-center justify-between gap-3 border-t border-border/60 bg-background/25 px-4 py-3">
              <PromptInputTools className="gap-2 text-xs text-muted-foreground">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="Add images or files" aria-label="Add images or files">
                    <Plus className="size-4" />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent className="min-w-52">
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <span>Enter sends</span>
                <span className="text-muted-foreground/50">Shift+Enter for a new line</span>
              </PromptInputTools>
              <PromptInputSubmit
                status={busy ? "submitted" : "ready"}
                disabled={busy || !prompt.trim()}
                className="new-session-submit rounded-full border border-primary/30 bg-primary/90 px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary"
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                <span className="hidden sm:inline">Send</span>
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>

          <Suggestions className="new-session-suggestions">
            {GET_STARTED_PROMPTS.map((suggestion) => (
              <Suggestion
                key={suggestion}
                suggestion={suggestion}
                disabled={busy}
                className="new-session-suggestion"
                onClick={setPrompt}
              />
            ))}
          </Suggestions>
        </section>

        <aside className="new-session-runtime" aria-label="Runtime status">
          <div className="new-session-runtime-copy">
            <p className="new-session-runtime-label">Runtime</p>
            <p className="new-session-runtime-caption">Local workspace</p>
          </div>

          <div className="new-session-runtime-list">
            {runtimeItems.map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="new-session-runtime-row">
                <span className="new-session-runtime-icon" data-tone={tone}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="new-session-runtime-name">{label}</span>
                <span className="new-session-runtime-value">
                  {formatStatusText(value)}
                </span>
              </div>
            ))}
          </div>

          <div className="new-session-runtime-status">
            <StatusPill tone={toneForService(runtime?.api)}>
              {formatStatusText(runtime?.api.state ?? health?.status ?? "offline")}
            </StatusPill>
          </div>

          {showWarmup ? (
            <div className="new-session-warmup">
              <WarmupProgress flow={createFlow} />
            </div>
          ) : null}
        </aside>
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

const BROWSER_PROVIDER_CONFIG_PREVIEW: ProviderConfig = {
  activeProvider: "openai",
  activeModel: DEFAULT_PROVIDER_MODELS.openai,
  codexCliPath: "",
  codexCliCwd: "",
  codexOauth: {
    enabled: true,
    model: DEFAULT_PROVIDER_MODELS["codex-cli"],
    reasoningEffort: "medium",
    approvalMode: "never",
    sandboxMode: "read-only",
  },
  kimiCoding: {
    enabled: false,
    providerPackage: "@ai-sdk/openai-compatible",
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    authMode: "api-key",
    status: "planned",
    notes: [],
  },
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
  providerConfig,
  saveSettings,
  saveProviderConfig,
  refreshSettings,
  runServiceAction,
  busyAction,
  isTauri,
}: {
  runtime: RuntimeStatus | null;
  health: HealthResponse | null;
  metrics: MetricsResponse | null;
  runtimeSettings: RuntimeSettings | null;
  providerConfig: ProviderConfig | null;
  saveSettings: (settings: RuntimeSettings) => Promise<void>;
  saveProviderConfig: (config: ProviderConfig) => Promise<void>;
  refreshSettings: () => Promise<void>;
  runServiceAction: (service: LocalServiceName, action: "start" | "stop") => Promise<void>;
  busyAction: string | null;
  isTauri: boolean;
}) {
  const [draftSettings, setDraftSettings] = useState<RuntimeSettings | null>(runtimeSettings);
  const [draftProviderConfig, setDraftProviderConfig] = useState<ProviderConfig | null>(providerConfig);

  useEffect(() => {
    setDraftSettings(runtimeSettings);
  }, [runtimeSettings]);

  useEffect(() => {
    setDraftProviderConfig(providerConfig);
  }, [providerConfig]);

  const effectiveSettings = draftSettings ?? (!isTauri ? BROWSER_RUNTIME_SETTINGS_PREVIEW : null);
  const effectiveProviderConfig = draftProviderConfig ?? (!isTauri ? BROWSER_PROVIDER_CONFIG_PREVIEW : null);

  if (!effectiveSettings || !effectiveProviderConfig) {
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
  const saveProviderBusy = busyAction === "save-provider-config";
  const imageBuildBusy = busyAction === "start-agentImage";
  const serviceCards = [runtime?.api, runtime?.docker, runtime?.agentImage].filter(Boolean) as ManagedServiceStatus[];
  const apiProviderMismatch =
    Boolean(health?.agent) &&
    (health?.agent.provider !== effectiveProviderConfig.activeProvider ||
      health?.agent.model !== effectiveProviderConfig.activeModel);
  const providerDirty =
    Boolean(providerConfig) &&
    (providerConfig?.activeProvider !== effectiveProviderConfig.activeProvider ||
      providerConfig?.activeModel !== effectiveProviderConfig.activeModel ||
      providerConfig?.codexCliPath !== effectiveProviderConfig.codexCliPath ||
      providerConfig?.codexCliCwd !== effectiveProviderConfig.codexCliCwd);

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

  const updateProviderDraft = (patch: Partial<ProviderConfig>) => {
    setDraftProviderConfig((current) => ({
      ...(current ?? BROWSER_PROVIDER_CONFIG_PREVIEW),
      ...patch,
    }));
  };

  const selectProvider = (provider: LlmProvider) => {
    updateProviderDraft({
      activeProvider: provider,
      activeModel: defaultModelForProvider(provider),
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
                  <Settings className="h-5 w-5 text-primary" />
                  Settings
                </CardTitle>
                <CardDescription>Runtime, provider, and image.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 rounded-lg border border-border bg-background/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Provider</p>
                </div>
                <StatusPill tone="info">{labelForProvider(effectiveProviderConfig.activeProvider)}</StatusPill>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/20 px-3 py-2 text-xs text-muted-foreground">
                <span>Running API</span>
                <StatusPill tone={apiProviderMismatch ? "warning" : "positive"}>
                  {health?.agent ? `${labelForProvider(health.agent.provider)} · ${health.agent.model}` : "unknown"}
                </StatusPill>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="grid gap-2">
                  <Label htmlFor="llm-provider">Provider</Label>
                  <Select
                    value={effectiveProviderConfig.activeProvider}
                    disabled={!isTauri}
                    onValueChange={(value) => selectProvider(value as LlmProvider)}
                  >
                    <SelectTrigger id="llm-provider" className="w-full bg-background/45">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LLM_PROVIDER_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {LLM_PROVIDER_OPTIONS.find((option) => option.id === effectiveProviderConfig.activeProvider)?.detail}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="llm-model">Model</Label>
                  <Input
                    id="llm-model"
                    value={effectiveProviderConfig.activeModel}
                    disabled={!isTauri}
                    onChange={(event) => updateProviderDraft({ activeModel: event.target.value })}
                    placeholder={defaultModelForProvider(effectiveProviderConfig.activeProvider)}
                    className="bg-background/45"
                  />
                </div>
              </div>

              {effectiveProviderConfig.activeProvider === "codex-cli" ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="grid gap-2">
                    <Label htmlFor="codex-cli-path">Codex path</Label>
                    <Input
                      id="codex-cli-path"
                      value={effectiveProviderConfig.codexCliPath}
                      disabled={!isTauri}
                      onChange={(event) => updateProviderDraft({ codexCliPath: event.target.value })}
                      placeholder="codex"
                      className="bg-background/45"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="codex-cli-cwd">Codex cwd</Label>
                    <Input
                      id="codex-cli-cwd"
                      value={effectiveProviderConfig.codexCliCwd}
                      disabled={!isTauri}
                      onChange={(event) => updateProviderDraft({ codexCliCwd: event.target.value })}
                      placeholder="Repo root"
                      className="bg-background/45"
                    />
                  </div>
                </div>
              ) : null}

              {runtime?.api.state === "running" && providerDirty ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Saving restarts the app API for new sessions.</span>
                </div>
              ) : null}

              {!providerDirty && apiProviderMismatch ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Running API uses a different provider.</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Last saved: {effectiveProviderConfig.updatedAtMs ? formatTime(effectiveProviderConfig.updatedAtMs) : "not saved"}
                </p>
                <Button
                  disabled={!isTauri || saveProviderBusy}
                  onClick={() => void saveProviderConfig(effectiveProviderConfig)}
                >
                  {saveProviderBusy ? <Loader2 className="animate-spin" /> : <Save />}
                  Save provider
                </Button>
              </div>
            </div>

            <div className="grid gap-4 rounded-lg border border-border bg-background/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Image</p>
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

function isToolMessagePart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function hasVisibleMessageParts(message: UIMessage): boolean {
  return Array.isArray(message.parts) && message.parts.length > 0;
}

function formatChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("Message must contain at least one part") || raw.includes("\"too_small\"")) {
    return "A previous empty assistant response was removed. Try sending the message again.";
  }

  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.length > 0) {
        return parsed.message;
      }
    } catch {
      // Fall through to the original error string.
    }
  }

  return raw;
}

function renderMessagePart(part: UIMessage["parts"][number], key: string) {
  if (part.type === "text") {
    return <MessageResponse key={key}>{part.text}</MessageResponse>;
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning key={key} isStreaming={part.state === "streaming"}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (isToolMessagePart(part)) {
    const errorText = "errorText" in part ? part.errorText : undefined;
    const output = "output" in part ? part.output : undefined;

    const header = part.type === "dynamic-tool" ? (
      <ToolHeader type="dynamic-tool" state={part.state} title={part.title} toolName={part.toolName} />
    ) : (
      <ToolHeader type={part.type} state={part.state} title={part.title} />
    );

    return (
      <Tool key={key} defaultOpen={false}>
        {header}
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={output} errorText={errorText} />
        </ToolContent>
      </Tool>
    );
  }

  if (part.type === "file") {
    const isImage = typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
    const label = part.filename ?? part.mediaType;

    if (isImage) {
      return (
        <figure key={key} className="max-w-full overflow-hidden rounded-lg border border-border/70 bg-background/40">
          <a href={part.url} target="_blank" rel="noreferrer" className="block">
            <img
              alt={label}
              className="block max-h-[32rem] w-full object-contain"
              src={part.url}
            />
          </a>
          {label ? (
            <figcaption className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <a href={part.url} target="_blank" rel="noreferrer" className="hover:underline">
                {label}
              </a>
            </figcaption>
          ) : null}
        </figure>
      );
    }

    return (
      <a key={key} href={part.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">
        {label}
      </a>
    );
  }

  return null;
}

function SessionChatView({
  session,
  pendingInitialPrompt,
  clearPendingInitialPrompt,
  onChatStatusChange,
  refreshLogs,
}: {
  session: SessionSummary;
  pendingInitialPrompt: PendingInitialPrompt | null;
  clearPendingInitialPrompt: (sessionId: string) => void;
  onChatStatusChange: (status: ChatStatus) => void;
  refreshLogs: () => void;
}) {
  const ready = session.status === "ready" || session.status === "running";
  const [input, setInput] = useState("");
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const autoSubmittedRef = useRef<string | null>(null);
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api: ottobotApi.chatEndpoint(session.session_id) }),
    [session.session_id],
  );
  const { messages, setMessages, sendMessage, status, stop, error } = useChat<UIMessage>({
    id: session.session_id,
    transport,
    onFinish: () => refreshLogs(),
    onError: (chatError) => setLoadError(formatChatError(chatError)),
  });
  const visibleMessages = useMemo(() => messages.filter(hasVisibleMessageParts), [messages]);

  useEffect(() => {
    onChatStatusChange(status);
  }, [onChatStatusChange, status]);

  useEffect(() => {
    let cancelled = false;
    setMessagesLoaded(false);
    setLoadError(null);
    setMessages([]);

    ottobotApi.getSessionMessages(session.session_id)
      .then((response) => {
        if (!cancelled) setMessages(response.messages.filter(hasVisibleMessageParts));
      })
      .catch((messageError: unknown) => {
        if (!cancelled) setLoadError(formatChatError(messageError));
      })
      .finally(() => {
        if (!cancelled) setMessagesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [session.session_id, setMessages]);

  const followLatestKey = useMemo(() => {
    const latestMessage = visibleMessages[visibleMessages.length - 1];
    if (!latestMessage) return "empty";

    const partsSignature = latestMessage.parts
      .map((part) => {
        if (part.type === "text") {
          return `text:${part.text.length}`;
        }

        if (part.type === "reasoning") {
          return `reasoning:${part.state}:${part.text.length}`;
        }

        if (isToolMessagePart(part)) {
          return `tool:${part.type}:${part.state}:${part.title ?? ""}:${"toolName" in part ? part.toolName : ""}`;
        }

        if (part.type === "file") {
          return `file:${part.url}`;
        }

        return part.type;
      })
      .join("|");

    return `${latestMessage.id}:${latestMessage.role}:${partsSignature}`;
  }, [visibleMessages]);

  useEffect(() => {
    if (!ready || !messagesLoaded || visibleMessages.length > 0 || status !== "ready") return;
    if (pendingInitialPrompt?.sessionId !== session.session_id) return;
    if (autoSubmittedRef.current === session.session_id) return;

    autoSubmittedRef.current = session.session_id;
    clearPendingInitialPrompt(session.session_id);
    void sendMessage({
      files: pendingInitialPrompt.files,
      text: pendingInitialPrompt.prompt,
    }).catch((submitError: unknown) => {
      autoSubmittedRef.current = null;
      setLoadError(formatChatError(submitError));
    });
  }, [
    clearPendingInitialPrompt,
    messagesLoaded,
    pendingInitialPrompt,
    ready,
    sendMessage,
    session.session_id,
    status,
    visibleMessages.length,
  ]);

  const canSubmit = ready && status === "ready" && input.trim().length > 0;

  return (
    <Card className={cn(deskSolidSurfaceClass, "flex h-full min-h-[32rem] flex-col overflow-hidden")}>
      <CardHeader className="shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{session.initial_prompt || "Session"}</CardTitle>
            <CardDescription>
              {formatTime(session.created_at)} · {status}
            </CardDescription>
          </div>
          <StatusPill tone={statusTone(session.status) as Tone}>{session.status}</StatusPill>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {!ready ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Starting session.</span>
          </div>
        ) : null}
        {loadError || error ? (
          <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
            {loadError ?? formatChatError(error)}
          </div>
        ) : null}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4 p-4 sm:p-5">
            <ConversationFollowLatest followKey={followLatestKey} enabled={status === "streaming" || status === "submitted" || visibleMessages.length > 0} />
            {!messagesLoaded ? (
              <ConversationEmptyState
                icon={<Loader2 className="h-5 w-5 animate-spin" />}
                title="Loading messages"
                description="Restoring conversation."
              />
            ) : visibleMessages.length === 0 ? (
              <ConversationEmptyState
                icon={<MessageSquare className="h-5 w-5" />}
                title={ready ? "Ready" : "Starting"}
                description={ready ? "Send a prompt." : "Waiting for the session."}
              />
            ) : (
              visibleMessages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent
                    className={cn(
                      message.role === "user"
                        ? "border border-sky-400/20 bg-sky-400/10"
                        : "w-full",
                    )}
                  >
                    {message.parts.map((part, index) => renderMessagePart(part, `${message.id}-${index}`))}
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <PromptInput
          className={cn(
            "rounded-2xl border border-border/70 bg-gradient-to-b from-background/80 via-background/55 to-background/30 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.85)] backdrop-blur-xl",
            "[&_[data-slot=input-group]]:overflow-hidden [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-border/70 [&_[data-slot=input-group]]:bg-background/30 [&_[data-slot=input-group]]:shadow-none",
            "[&_[data-slot=input-group-addon]]:bg-transparent"
          )}
          onSubmit={async (message) => {
            const text = message.text.trim();
            if (!text || !ready || status !== "ready") return;
            await sendMessage({ text, files: message.files });
            setInput("");
          }}
        >
          <PromptInputHeader className="flex items-center justify-between gap-3 px-4 pt-4 pb-0 text-xs">
            <span className="font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Compose
            </span>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span
                className={cn(
                  "size-2 rounded-full",
                  composerStatusTone(status, ready) === "positive"
                    ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]"
                    : composerStatusTone(status, ready) === "warning"
                      ? "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]"
                      : "bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.12)]"
                )}
              />
              {composerStatusLabel(status, ready)}
            </span>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              disabled={!ready || status === "submitted" || status === "streaming"}
              placeholder="Message OttoBot..."
              className="min-h-24 border-0 bg-transparent px-4 py-3 text-[0.98rem] leading-6 placeholder:text-muted-foreground/65 focus-visible:ring-0"
            />
          </PromptInputBody>
          <PromptInputFooter className="items-center justify-between gap-3 border-t border-border/60 bg-background/25 px-4 py-3">
            <PromptInputTools className="gap-2 text-xs text-muted-foreground">
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Add images or files" aria-label="Add images or files">
                  <Plus className="size-4" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent className="min-w-52">
                  <PromptInputActionAddAttachments />
                  <PromptInputActionAddScreenshot />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <span>Enter sends</span>
              <span className="text-muted-foreground/50">Shift+Enter for a new line</span>
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!canSubmit && status !== "submitted" && status !== "streaming"}
              className="rounded-full border border-primary/30 bg-primary/90 px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary"
            />
          </PromptInputFooter>
        </PromptInput>
      </CardContent>
    </Card>
  );
}

function SessionArtifactView({
  session,
  chatStatus,
  logs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
  deleteSession,
  busyDelete,
}: {
  session: SessionSummary | null;
  chatStatus: ChatStatus;
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
            <CardTitle>Desktop</CardTitle>
            <CardDescription className="mt-2">
              Select a session to view it.
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
            <CardDescription>{ready ? `Live · ${chatStatus}` : "Waiting"}</CardDescription>
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
              Waiting for desktop.
            </div>
          </div>
        )}
        <SessionDiagnosticsPanel
          session={session}
          ready={ready}
          chatStatus={chatStatus}
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
  chatStatus,
  vncUrl,
  logs,
  logsError,
  logsLoading,
  logsUpdatedAt,
  refreshLogs,
}: {
  session: SessionSummary;
  ready: boolean;
  chatStatus: ChatStatus;
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
          <span className="text-muted-foreground">Chat</span>
          <StatusPill tone={chatStatusTone(chatStatus)}>{chatStatus}</StatusPill>
        </div>
        <div className="grid min-w-0 gap-1">
          <span className="text-muted-foreground">Desktop</span>
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
