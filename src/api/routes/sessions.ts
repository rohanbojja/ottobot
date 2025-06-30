import { Elysia, t } from 'elysia';
import { 
  CreateSessionSchema, 
  SessionResponseSchema, 
  SessionIdParamSchema,
  SessionLogsResponseSchema 
} from '@/shared/schemas/session';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { CONFIG } from '@/shared/config';
import { JOB_NAMES } from '@/shared/queue';
import type { CreateSessionRequest, SessionResponse } from '@/shared/types';

const logger = createLogger('session-routes');

export const sessionRoutes = new Elysia({ prefix: '/session' })
  .post('/', async ({ body, queue, redis, set }) => {
    try {
      const { initial_prompt, timeout, environment } = body as CreateSessionRequest;
      
      // Create session
      const session = await SessionManager.createSession(initial_prompt, timeout);
      
      // Allocate VNC port
      const vncPort = await SessionManager.allocateVncPort();
      if (!vncPort) {
        await SessionManager.deleteSession(session.id);
        set.status = 503;
        return {
          error: 'Service Unavailable',
          message: 'No available VNC ports',
        };
      }

      // Update session with VNC port
      await SessionManager.updateSession(session.id, { vncPort });

      // Queue session creation job
      await queue.add(JOB_NAMES.createSession, {
        type: 'create_session',
        sessionId: session.id,
        data: {
          initialPrompt: initial_prompt,
          environment: environment || 'full-stack',
          vncPort,
        },
      }, {
        priority: 1,
      });

      // Increment total sessions metric
      await redis.incr('metrics:total_sessions');

      // Build response
      const response: SessionResponse = {
        session_id: session.id,
        status: session.status,
        vnc_url: `http://${CONFIG.api.host}:${vncPort}/vnc.html`,
        chat_url: `ws://${CONFIG.api.host}:${CONFIG.api.port}/session/${session.id}/chat`,
        created_at: session.createdAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
      };

      logger.info(`Created session ${session.id}`);
      set.status = 201;
      return response;
    } catch (error) {
      logger.error('Error creating session:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to create session',
      };
    }
  }, {
    body: CreateSessionSchema,
    response: {
      201: SessionResponseSchema
    },
    detail: {
      tags: ['sessions'],
      summary: 'Create a new coding session',
      description: 'Creates a new interactive coding session with AI agent and VNC access',
    },
  })
  .get('/:id', async ({ params, set }) => {
    try {
      const { id } = params;
      const session = await SessionManager.getSession(id);
      
      if (!session) {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'Session not found',
        };
      }

      const response: SessionResponse = {
        session_id: session.id,
        status: session.status,
        vnc_url: session.vncPort 
          ? `http://${CONFIG.api.host}:${session.vncPort}/vnc.html`
          : '',
        chat_url: `ws://${CONFIG.api.host}:${CONFIG.api.port}/session/${session.id}/chat`,
        created_at: session.createdAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
      };

      return response;
    } catch (error) {
      logger.error('Error getting session:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to get session',
      };
    }
  }, {
    params: SessionIdParamSchema,
    response: {
      200: SessionResponseSchema
    },
    detail: {
      tags: ['sessions'],
      summary: 'Get session status',
      description: 'Retrieves the current status of a coding session',
    },
  })
  .delete('/:id', async ({ params, queue, set }) => {
    try {
      const { id } = params;
      const session = await SessionManager.getSession(id);
      
      if (!session) {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'Session not found',
        };
      }

      // Update status
      await SessionManager.updateSessionStatus(id, 'terminating');

      // Queue termination job
      await queue.add(JOB_NAMES.terminateSession, {
        type: 'terminate_session',
        sessionId: id,
        data: {
          containerId: session.containerId,
          vncPort: session.vncPort,
        },
      }, {
        priority: 2,
      });

      set.status = 202;
      return {
        message: 'Session termination initiated',
        session_id: id,
      };
    } catch (error) {
      logger.error('Error terminating session:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to terminate session',
      };
    }
  }, {
    params: SessionIdParamSchema,
    response: {
      202: t.Object({
        message: t.String(),
        session_id: t.String()
      })
    },
    detail: {
      tags: ['sessions'],
      summary: 'Terminate session',
      description: 'Initiates termination of a coding session',
    },
  })
  .get('/:id/logs', async ({ params, query, set }) => {
    try {
      const { id } = params;
      const limit = query.limit ? parseInt(query.limit as string, 10) : 100;
      
      const session = await SessionManager.getSession(id);
      if (!session) {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'Session not found',
        };
      }

      const logs = await SessionManager.getSessionLogs(id, limit);
      
      return {
        session_id: id,
        logs,
      };
    } catch (error) {
      logger.error('Error getting session logs:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to get session logs',
      };
    }
  }, {
    params: SessionIdParamSchema,
    response: {
      200: SessionLogsResponseSchema
    },
    detail: {
      tags: ['sessions'],
      summary: 'Get session logs',
      description: 'Retrieves logs for a specific session',
    },
  });