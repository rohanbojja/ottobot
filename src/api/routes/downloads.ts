import { Elysia, t } from 'elysia';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';

const logger = createLogger('download-routes');

export const downloadRoutes = new Elysia({ prefix: '/download' })
  .get('/:id', async ({ params, set }) => {
    try {
      const { id } = params;
      
      // Validate session exists
      const session = await SessionManager.getSession(id);
      if (!session) {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'Session not found',
        };
      }

      // Check if session has MCP port (container is running)
      if (!session.mcpPort) {
        set.status = 400;
        return {
          error: 'Bad Request',
          message: 'Session container is not running',
        };
      }

      // Redirect to container's MCP server /download endpoint
      const mcpUrl = `http://localhost:${session.mcpPort}/download`;
      logger.info(`Redirecting download request for session ${id} to ${mcpUrl}`);
      set.status = 302;
      set.headers['Location'] = mcpUrl;
      return;
    } catch (error) {
      logger.error('Error downloading session files:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to download session files',
      };
    }
  }, {
    params: t.Object({
      id: t.String({ description: 'Session ID' })
    }),
    detail: {
      tags: ['downloads'],
      summary: 'Download session workspace',
      description: 'Downloads the complete workspace for a session as a zip file',
    },
  });