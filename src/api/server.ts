import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { CONFIG } from "@/shared/config";
import { createLogger } from "@/shared/logger";
import { redisPlugin } from "./plugins/redis";
import { queuePlugin } from "./plugins/queue";
import { sessionRoutes } from "./routes/sessions";
import { healthRoutes } from "./routes/health";
import { downloadRoutes } from "./routes/downloads";
import { chatWebSocketHandler } from "./websocket/chat-handler";

const logger = createLogger("api-server");

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
        origin: CONFIG.security.corsOrigins,
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
          ],
        },
      }),
    )
    .use(redisPlugin)
    .use(queuePlugin)
    // Routes
    .use(healthRoutes)
    .use(sessionRoutes)
    .use(downloadRoutes)
    // WebSocket endpoint
    .ws("/session/:id/chat", chatWebSocketHandler)
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
