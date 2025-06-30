import type { ElysiaWS } from 'elysia/ws';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { UserMessageSchema } from '@/shared/schemas/websocket';
import { JOB_NAMES } from '@/shared/queue';
import type { ChatMessage } from '@/shared/types';

const logger = createLogger('websocket');

export const chatWebSocketHandler = {
  open(ws: any) {
    const sessionId = ws.data.params.id;
    logger.info(`WebSocket opened for session ${sessionId}`);

    // Validate session exists
    SessionManager.getSession(sessionId).then(session => {
      if (!session) {
        ws.send({
          type: 'error',
          error: 'Session not found',
          timestamp: Date.now(),
        });
        ws.close();
        return;
      }

      // Check session status
      if (session.status === 'terminated' || session.status === 'error') {
        ws.send({
          type: 'error',
          error: `Session is ${session.status}`,
          timestamp: Date.now(),
        });
        ws.close();
        return;
      }

      // Send connection confirmation
      ws.send({
        type: 'system_update',
        content: 'Connected to session',
        timestamp: Date.now(),
        metadata: {
          session_status: session.status,
        },
      });

      // Send recent messages if any
      SessionManager.getSessionMessages(sessionId, 50).then(recentMessages => {
        for (const message of recentMessages) {
          ws.send(message);
        }
      });
    });
  },
  
  message(ws: any, message: any) {
    const sessionId = ws.data.params.id;
    
    try {
      // Validate message format
      const parsedMessage = UserMessageSchema.parse(message);
      
      // Get session
      SessionManager.getSession(sessionId).then(session => {
        if (!session) {
          ws.send({
            type: 'error',
            error: 'Session not found',
            timestamp: Date.now(),
          });
          return;
        }

        // Check if session is ready
        if (session.status !== 'ready' && session.status !== 'running') {
          ws.send({
            type: 'error',
            error: `Session is not ready (status: ${session.status})`,
            timestamp: Date.now(),
          });
          return;
        }

        // Store message
        SessionManager.addSessionMessage(sessionId, parsedMessage);

        // Update session status
        SessionManager.updateSessionStatus(sessionId, 'running');

        // Queue message for processing
        const queue = ws.data.queue;
        queue.add(JOB_NAMES.processMessage, {
          type: 'process_message',
          sessionId,
          data: {
            message: parsedMessage,
            workerId: session.workerId,
          },
        }, {
          priority: 1,
        });

        // Send acknowledgment
        ws.send({
          type: 'system_update',
          content: 'Message received and queued for processing',
          timestamp: Date.now(),
        });

        logger.info(`Message from session ${sessionId}:`, parsedMessage.content);
      }).catch(error => {
        logger.error('Session handling error:', error);
        ws.send({
          type: 'error',
          error: 'Internal server error',
          timestamp: Date.now(),
        });
      });
    } catch (error) {
      logger.error('WebSocket message error:', error);
      ws.send({
        type: 'error',
        error: 'Invalid message format',
        timestamp: Date.now(),
      });
    }
  },
  
  close(ws: any) {
    const sessionId = ws.data.params.id;
    logger.info(`WebSocket closed for session ${sessionId}`);
  },
  
  error(ws: any, error: Error) {
    const sessionId = ws.data.params.id;
    logger.error(`WebSocket error for session ${sessionId}:`, error);
  },
};