import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ManagedServiceStatus = {
  key: string;
  label: string;
  state: "running" | "stopped" | "unknown" | "error";
  managed: boolean;
  pid?: number | null;
  detail: string;
  checkedAtMs: number;
  startedAtMs?: number | null;
};

export type RuntimeStatus = {
  api: ManagedServiceStatus;
  docker: ManagedServiceStatus;
  agentImage: ManagedServiceStatus;
  notes: string[];
  checkedAtMs: number;
};

export type LocalServiceName = "api" | "agentImage";

export const DEFAULT_AGENT_IMAGE = "ottobot-agent";

export type RuntimeSettings = {
  useDefaultAgentImage: boolean;
  agentImage: string;
  updatedAtMs: number;
};

export type ProviderConfig = {
  activeProvider: string;
  activeModel: string;
  codexOauth: {
    enabled: boolean;
    model: string;
    reasoningEffort: string;
    approvalMode: string;
    sandboxMode: string;
  };
  kimiCoding: {
    enabled: boolean;
    providerPackage: string;
    baseUrl: string;
    model: string;
    authMode: string;
    status: string;
    notes: string[];
  };
  updatedAtMs: number;
};

export type CodexAuthStatus = {
  available: boolean;
  connected: boolean;
  authMode: string;
  detail: string;
  codexPath?: string | null;
  checkedAtMs: number;
};

export function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkLocalRuntime() {
  return invoke<RuntimeStatus>("check_local_runtime");
}

export async function startLocalService(service: LocalServiceName) {
  return invoke<ManagedServiceStatus>("start_local_service", { service });
}

export async function stopLocalService(service: LocalServiceName) {
  return invoke<ManagedServiceStatus>("stop_local_service", { service });
}

export async function getRuntimeSettings() {
  return invoke<RuntimeSettings>("get_runtime_settings");
}

export async function saveRuntimeSettings(settings: RuntimeSettings) {
  return invoke<RuntimeSettings>("save_runtime_settings", { settings });
}

export async function getProviderConfig() {
  return invoke<ProviderConfig>("get_provider_config");
}

export async function saveProviderConfig(config: ProviderConfig) {
  return invoke<ProviderConfig>("save_provider_config", { config });
}

export async function getCodexAuthStatus() {
  return invoke<CodexAuthStatus>("get_codex_auth_status");
}

export async function startCodexOauthSetup() {
  return invoke<CodexAuthStatus>("start_codex_oauth_setup");
}

export async function startWindowDrag() {
  if (!hasTauriRuntime()) return;
  await getCurrentWindow().startDragging();
}
