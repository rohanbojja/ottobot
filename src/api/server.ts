import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { CONFIG } from "@/shared/config";
import { createLogger } from "@/shared/logger";
import { sessionRoutes } from "./routes/sessions";
import { healthRoutes } from "./routes/health";
import { downloadRoutes } from "./routes/downloads";

const logger = createLogger("api-server");

const normalizeCorsOrigin = (origin: string) => {
  let normalized = origin.trim().replace(/\/$/, "");
  const protocolStart = normalized.indexOf("://");
  if (protocolStart !== -1) normalized = normalized.slice(protocolStart + 3);
  return normalized;
};

const allowedCorsOrigins = new Set(
  CONFIG.security.corsOrigins.flatMap((origin) => [
    origin,
    normalizeCorsOrigin(origin),
  ]),
);

const isLoopbackDevOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const isCorsOriginAllowed = (request: Request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  return (
    allowedCorsOrigins.has(origin) ||
    allowedCorsOrigins.has(normalizeCorsOrigin(origin)) ||
    isLoopbackDevOrigin(origin)
  );
};

export const createApiServer = () => {
  const app = new Elysia()
    // Global error handler
    .onError(({ code, error, set }) => {
      logger.error(`Error: ${code}`, error);

      if (code === "VALIDATION") {
        set.status = 400;
        return {
          error: "Validation Error",
          message: error.message,
        };
      }

      if (code === "NOT_FOUND") {
        set.status = 404;
        return {
          error: "Not Found",
          message: "The requested resource was not found",
        };
      }

      set.status = 500;
      return {
        error: "Internal Server Error",
        message: "An unexpected error occurred",
      };
    })
    // Plugins
    .use(
      cors({
        origin: isCorsOriginAllowed,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
      }),
    )
    .use(
      swagger({
        documentation: {
          info: {
            title: "OttoBot API",
            version: "1.0.0",
            description:
              "OttoBot - Interactive coding agent platform with VNC and AI assistance",
          },
          tags: [
            { name: "sessions", description: "Session management endpoints" },
            { name: "health", description: "Health and monitoring endpoints" },
            { name: "downloads", description: "File download endpoints" },
            { name: "admin", description: "Administrative endpoints" },
          ],
        },
      }),
    )
    // Routes
    .use(healthRoutes)
    .use(sessionRoutes)
    .use(downloadRoutes)
    // Request logging
    .onRequest(({ request }) => {
      logger.info(`${request.method} ${request.url}`);
    })
    // Graceful shutdown
    .onStop(() => {
      logger.info("API server shutting down...");
    });

  return app;
};

// Export for testing
export type ApiServer = ReturnType<typeof createApiServer>;
