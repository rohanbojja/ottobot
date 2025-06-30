import { Elysia } from 'elysia';
import { DownloadParamsSchema } from '@/shared/schemas/session';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import path from 'path';
import fs from 'fs/promises';

const logger = createLogger('download-routes');

export const downloadRoutes = new Elysia({ prefix: '/download' })
  .get('/:id/:file', async ({ params, set }) => {
    try {
      const { id, file } = params;
      
      // Validate session exists
      const session = await SessionManager.getSession(id);
      if (!session) {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'Session not found',
        };
      }

      // Sanitize file name
      const sanitizedFile = path.basename(file);
      if (sanitizedFile !== file) {
        set.status = 400;
        return {
          error: 'Bad Request',
          message: 'Invalid file name',
        };
      }

      // Build file path
      const filePath = path.join('/app/session-data', id, 'artifacts', sanitizedFile);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        set.status = 404;
        return {
          error: 'Not Found',
          message: 'File not found',
        };
      }

      // Read file
      const fileContent = await fs.readFile(filePath);
      const stats = await fs.stat(filePath);

      // Set appropriate headers
      set.headers['Content-Type'] = 'application/octet-stream';
      set.headers['Content-Disposition'] = `attachment; filename="${sanitizedFile}"`;
      set.headers['Content-Length'] = stats.size.toString();

      logger.info(`Download requested for session ${id}, file: ${sanitizedFile}`);
      
      return fileContent;
    } catch (error) {
      logger.error('Error downloading file:', error);
      set.status = 500;
      return {
        error: 'Internal Server Error',
        message: 'Failed to download file',
      };
    }
  }, {
    params: DownloadParamsSchema,
    detail: {
      tags: ['downloads'],
      summary: 'Download session artifact',
      description: 'Downloads a file artifact from a session',
    },
  });