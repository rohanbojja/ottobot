import { CONFIG, validateConfig } from './shared/config';
import { createLogger } from './shared/logger';
import { createApiServer } from './api/server';
import { startWorker } from './worker/worker';

const logger = createLogger('main');

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const mode = CONFIG.mode;
    logger.info(`Starting in ${mode} mode`);

    if (mode === 'api') {
      // Start API server
      const app = createApiServer();
      
      app.listen(CONFIG.api.port, () => {
        logger.info(`API server listening on ${CONFIG.api.host}:${CONFIG.api.port}`);
        logger.info(`Swagger documentation available at http://${CONFIG.api.host}:${CONFIG.api.port}/swagger`);
      });

      // Graceful shutdown
      process.on('SIGTERM', async () => {
        logger.info('SIGTERM received, shutting down gracefully');
        await app.stop();
        process.exit(0);
      });

      process.on('SIGINT', async () => {
        logger.info('SIGINT received, shutting down gracefully');
        await app.stop();
        process.exit(0);
      });
    } else if (mode === 'worker') {
      // Start worker process
      await startWorker();
    } else {
      throw new Error(`Invalid mode: ${mode}`);
    }
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Run main function
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});