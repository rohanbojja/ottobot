import { Elysia, t } from "elysia";
import {
  CreateSessionSchema,
  ErrorResponseSchema,
  SessionResponseSchema,
  SessionIdParamSchema,
  SessionLogsResponseSchema,
} from "@/shared/schemas/session";
import { SessionManager } from "@/shared/session-manager";
import { createLogger } from "@/shared/logger";
import { CONFIG } from "@/shared/config";
import type { CreateSessionRequest, SessionResponse } from "@/shared/types";
import { localSessionOrchestrator } from "@/application/local-session-runtime";

const logger = createLogger("session-routes");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const sessionRoutes = new Elysia({ prefix: "/session" })
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const limit = query?.limit ? parseInt(query.limit as string, 10) : 20;
        const offset = query?.offset ? parseInt(query.offset as string, 10) : 0;

        // Get active sessions
        const sessions = await SessionManager.getActiveSessions();

        // Sort by creation date (newest first)
        sessions.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        // Apply pagination
        const paginatedSessions = sessions.slice(offset, offset + limit);

        // Transform to response format
        const response = paginatedSessions.map((session) => ({
          session_id: session.id,
          status: session.status,
          vnc_url: session.vncPort
            ? `http://localhost:${session.vncPort}/vnc.html`
            : "",
          chat_url: `ws://localhost:${CONFIG.api.port}/session/${session.id}/chat`,
          created_at: session.createdAt.toISOString(),
          expires_at: session.expiresAt.toISOString(),
          initial_prompt: session.initialPrompt,
        }));

        return {
          sessions: response,
          total: sessions.length,
          limit,
          offset,
        };
      } catch (error) {
        logger.error("Error listing sessions:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          message: "Failed to list sessions",
        };
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          sessions: t.Array(SessionResponseSchema),
          total: t.Number(),
          limit: t.Number(),
          offset: t.Number(),
        }),
        500: ErrorResponseSchema,
      },
      detail: {
        tags: ["sessions"],
        summary: "List active sessions",
        description: "Returns a paginated list of active sessions",
      },
    },
  )
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const { initial_prompt, timeout, environment } =
          body as CreateSessionRequest;

        // Create session
        const session = await SessionManager.createSession(
          initial_prompt,
          timeout,
        );

        // Allocate VNC port
        const vncPort = await SessionManager.allocateVncPort(session.id);
        if (!vncPort) {
          const message = "No available VNC ports";
          await SessionManager.updateSessionStatus(session.id, "error", message);
          await SessionManager.addSessionLog(session.id, "error", message);
          logger.warn(`Failed to allocate VNC port for session ${session.id}`);

          set.status = 503;
          return {
            error: "Service Unavailable",
            message,
          };
        }

        // Update session with VNC port
        await SessionManager.updateSession(session.id, { vncPort });
        await SessionManager.addSessionLog(
          session.id,
          "info",
          "Session accepted; starting sandbox in background...",
          { vncPort, environment: environment || "full-stack" },
        );

        void localSessionOrchestrator
          .createSession({
            type: "create_session",
            sessionId: session.id,
            data: {
              initialPrompt: initial_prompt,
              environment: environment || "full-stack",
              vncPort,
            },
          })
          .catch(async (error: unknown) => {
            const errorMessage = getErrorMessage(error);
            logger.error(`Background session startup failed for ${session.id}:`, error);

            try {
              await SessionManager.updateSessionStatus(session.id, "error", errorMessage);
              await SessionManager.addSessionLog(
                session.id,
                "error",
                `Background session startup failed: ${errorMessage}`,
                {
                  vncPort,
                  environment: environment || "full-stack",
                },
              );
            } catch (logError) {
              logger.error(
                `Failed to record background startup failure for ${session.id}:`,
                logError,
              );
            }
          });

        // Build response
        const response: SessionResponse = {
          session_id: session.id,
          status: "initializing",
          vnc_url: `http://localhost:${vncPort}/vnc.html`,
          chat_url: `ws://localhost:${CONFIG.api.port}/session/${session.id}/chat`,
          created_at: session.createdAt.toISOString(),
          expires_at: session.expiresAt.toISOString(),
          initial_prompt: initial_prompt,
        };

        logger.info(`Created session ${session.id}`);
        set.status = 201;
        return response;
      } catch (error) {
        logger.error("Error creating session:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          message: "Failed to create session",
        };
      }
    },
    {
      body: CreateSessionSchema,
      response: {
        201: SessionResponseSchema,
        500: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
      detail: {
        tags: ["sessions"],
        summary: "Create a new coding session",
        description:
          "Creates a new interactive coding session with AI agent and VNC access",
      },
    },
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        const session = await SessionManager.getSession(id);

        if (!session) {
          set.status = 404;
          return {
            error: "Not Found",
            message: "Session not found",
          };
        }

        const response: SessionResponse = {
          session_id: session.id,
          status: session.status,
          vnc_url: session.vncPort
            ? `http://localhost:${session.vncPort}/vnc.html`
            : "",
          chat_url: `ws://localhost:${CONFIG.api.port}/session/${session.id}/chat`,
          created_at: session.createdAt.toISOString(),
          expires_at: session.expiresAt.toISOString(),
          initial_prompt: session.initialPrompt,
        };

        return response;
      } catch (error) {
        logger.error("Error getting session:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          message: "Failed to get session",
        };
      }
    },
    {
      params: SessionIdParamSchema,
      response: {
        200: SessionResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
      detail: {
        tags: ["sessions"],
        summary: "Get session status",
        description: "Retrieves the current status of a coding session",
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        const session = await SessionManager.getSession(id);

        if (!session) {
          set.status = 404;
          return {
            error: "Not Found",
            message: "Session not found",
          };
        }

        // Update status
        await SessionManager.updateSessionStatus(id, "terminating");

        await localSessionOrchestrator.terminateSession(
          {
            type: "terminate_session",
            sessionId: id,
            data: {
              containerId: session.containerId,
              vncPort: session.vncPort,
              mcpPort: session.mcpPort,
            },
          },
        );

        set.status = 202;
        return {
          message: "Session terminated",
          session_id: id,
        };
      } catch (error) {
        logger.error("Error terminating session:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          message: "Failed to terminate session",
        };
      }
    },
    {
      params: SessionIdParamSchema,
      response: {
        202: t.Object({
          message: t.String(),
          session_id: t.String(),
        }),
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
      detail: {
        tags: ["sessions"],
        summary: "Terminate session",
        description: "Initiates termination of a coding session",
      },
    },
  )
  .get(
    "/:id/logs",
    async ({ params, query, set }) => {
      try {
        const { id } = params;
        const limit = query['limit'] ? parseInt(query['limit'] as string, 10) : 100;

        const session = await SessionManager.getSession(id);
        if (!session) {
          set.status = 404;
          return {
            error: "Not Found",
            message: "Session not found",
          };
        }

        const logs = await SessionManager.getSessionLogs(id, limit);

        return {
          session_id: id,
          logs,
        };
      } catch (error) {
        logger.error("Error getting session logs:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          message: "Failed to get session logs",
        };
      }
    },
    {
      params: SessionIdParamSchema,
      response: {
        200: SessionLogsResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
      detail: {
        tags: ["sessions"],
        summary: "Get session logs",
        description: "Retrieves logs for a specific session",
      },
    },
  );
