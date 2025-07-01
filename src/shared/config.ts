export const CONFIG = {
  // API Configuration
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
    host: process.env.API_HOST || "0.0.0.0",
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
  },

  // Worker Configuration
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
    maxSessionsPerWorker: parseInt(
      process.env.MAX_SESSIONS_PER_WORKER || "5",
      10,
    ),
  },

  // Session Configuration
  session: {
    timeout: parseInt(process.env.SESSION_TIMEOUT || "3600", 10) * 1000, // Convert to ms
    secret: process.env.SESSION_SECRET || "change_this_secret_key",
  },

  // Agent Configuration
  agent: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.LLM_MODEL || "claude-3-sonnet-20240229",
    contextWindowSize: parseInt(
      process.env.CONTEXT_WINDOW_SIZE || "100000",
      10,
    ),
    maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
  },

  // Container Configuration
  container: {
    memoryLimit: process.env.CONTAINER_MEMORY_LIMIT || "2g",
    cpuLimit: parseFloat(process.env.CONTAINER_CPU_LIMIT || "1"),
    vncPortRangeStart: parseInt(process.env.VNC_PORT_RANGE_START || "6080", 10),
    vncPortRangeEnd: parseInt(process.env.VNC_PORT_RANGE_END || "6200", 10),
    network: process.env.CONTAINER_NETWORK || "ottobot-network",
    agentImage: process.env.AGENT_IMAGE || "node:20-alpine",
  },

  // Security Configuration
  security: {
    corsOrigins: process.env.CORS_ORIGINS || "localhost:5173",
    rateLimitWindowMs: 60 * 1000, // 1 minute
    rateLimitMaxRequests: 100,
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "json",
  },

  // Application Mode
  mode: (process.env.MODE as "api" | "worker") || "api",
} as const;

// Validate required configuration
export function validateConfig(): void {
  const errors: string[] = [];

  // Only require ANTHROPIC_API_KEY if not using mock agent
  if (!CONFIG.agent.anthropicApiKey && !process.env.AGENT_IMAGE) {
    errors.push("ANTHROPIC_API_KEY is required when using real agent");
  }

  if (CONFIG.container.vncPortRangeEnd <= CONFIG.container.vncPortRangeStart) {
    errors.push("VNC_PORT_RANGE_END must be greater than VNC_PORT_RANGE_START");
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join("\n")}`);
  }
}
