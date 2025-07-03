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

      // Proxy request to container's MCP server /download endpoint
      const mcpUrl = `http://localhost:${session.mcpPort}/download`;
      logger.info(`Proxying download request for session ${id} to ${mcpUrl}`);
      
      try {
        const response = await fetch(mcpUrl);
        
        if (!response.ok) {
          logger.error(`MCP server responded with ${response.status}: ${response.statusText}`);
          set.status = 502;
          return {
            error: 'Bad Gateway',
            message: 'Container download service unavailable',
          };
        }

        // Copy headers from MCP server response
        const contentType = response.headers.get('content-type') || 'application/zip';
        const contentDisposition = response.headers.get('content-disposition') || `attachment; filename="ottobot-session-${id}.zip"`;
        const contentLength = response.headers.get('content-length');
        
        set.headers['Content-Type'] = contentType;
        set.headers['Content-Disposition'] = contentDisposition;
        if (contentLength) {
          set.headers['Content-Length'] = contentLength;
        }
        
        // Return the response body as buffer
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (fetchError) {
        logger.error('Failed to fetch from MCP server:', fetchError);
        set.status = 502;
        return {
          error: 'Bad Gateway', 
          message: 'Failed to contact container download service',
        };
      }
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
    response: {
      200: t.Any({ description: 'ZIP file containing session workspace' }),
      400: t.Object({
        error: t.String(),
        message: t.String()
      }),
      404: t.Object({
        error: t.String(),
        message: t.String()
      }),
      502: t.Object({
        error: t.String(),
        message: t.String()
      })
    },
    detail: {
      tags: ['downloads'],
      summary: 'Download session workspace',
      description: 'Downloads the complete workspace for a session as a zip file',
    },
  });