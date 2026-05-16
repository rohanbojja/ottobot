const env = process.env;

export type LlmProvider = "openai" | "anthropic" | "google" | "codex-cli";

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:1430",
  "http://127.0.0.1:1430",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

function parseCsvList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : fallback;
}

function parseLlmProvider(value: string | undefined): LlmProvider {
  if (value === "anthropic" || value === "google" || value === "openai" || value === "codex-cli") {
    return value;
  }

  if (value === "codex") {
    return "codex-cli";
  }

  return "openai";
}

const llmProvider = parseLlmProvider(env["LLM_PROVIDER"]);

export const CONFIG = {
  // API Configuration
  api: {
    port: parseInt(env["API_PORT"] || "3000", 10),
    host: env["API_HOST"] || "0.0.0.0",
  },

  // Session Configuration
  session: {
    timeout: parseInt(env["SESSION_TIMEOUT"] || "3600", 10) * 1000, // Convert to ms
    secret: env["SESSION_SECRET"] || "change_this_secret_key",
    registryPath: env["OTTOBOT_SQLITE_PATH"] || "session-data/ottobot.sqlite",
  },

  // Agent Configuration
  agent: {
    provider: llmProvider,
    geminiApiKey: env["GEMINI_API_KEY"] || "",
    openaiApiKey: env["OPENAI_API_KEY"] || "",
    anthropicApiKey: env["ANTHROPIC_API_KEY"] || "",
    model: env["LLM_MODEL"] || (llmProvider === "codex-cli" ? "gpt-5.5" : "gpt-4.1-nano"),
    codexCliPath: env["CODEX_CLI_PATH"] || "",
    codexCliCwd: env["CODEX_CLI_CWD"] || "",
    maxSteps: parseInt(env["AI_AGENT_MAX_STEPS"] || "20", 10),
    contextWindowSize: parseInt(
      env["CONTEXT_WINDOW_SIZE"] || "100000",
      10,
    ),
    maxRetries: parseInt(env["MAX_RETRIES"] || "3", 10),
  },

  // Container Configuration
  container: {
    memoryLimit: env["CONTAINER_MEMORY_LIMIT"] || "2g",
    cpuLimit: parseFloat(env["CONTAINER_CPU_LIMIT"] || "1"),
    vncPortRangeStart: parseInt(env["VNC_PORT_RANGE_START"] || "6080", 10),
    vncPortRangeEnd: parseInt(env["VNC_PORT_RANGE_END"] || "6200", 10),
    mcpPortRangeStart: parseInt(env["MCP_PORT_RANGE_START"] || "8080", 10),
    mcpPortRangeEnd: parseInt(env["MCP_PORT_RANGE_END"] || "8200", 10),
    network: env["CONTAINER_NETWORK"] || "ottobot-network",
    agentImage: env["AGENT_IMAGE"] || "ottobot-agent",
    vncResolution: env["VNC_RESOLUTION"] || "1440x900x24",
  },

  // Security Configuration
  security: {
    corsOrigins: parseCsvList(env["CORS_ORIGINS"], DEFAULT_CORS_ORIGINS),
    rateLimitWindowMs: 60 * 1000, // 1 minute
    rateLimitMaxRequests: 100,
  },

  // Logging Configuration
  logging: {
    level: env["LOG_LEVEL"] || "info",
    format: env["LOG_FORMAT"] || "json",
  },

  // Application Mode
  mode: "api",
} as const;

// Validate required configuration
export function validateConfig(): void {
  const errors: string[] = [];

  if (CONFIG.container.vncPortRangeEnd <= CONFIG.container.vncPortRangeStart) {
    errors.push("VNC_PORT_RANGE_END must be greater than VNC_PORT_RANGE_START");
  }

  if (CONFIG.container.mcpPortRangeEnd <= CONFIG.container.mcpPortRangeStart) {
    errors.push("MCP_PORT_RANGE_END must be greater than MCP_PORT_RANGE_START");
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join("\n")}`);
  }
}
