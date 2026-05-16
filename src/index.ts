import { CONFIG, validateConfig } from './shared/config';
import { createLogger } from './shared/logger';
import { createApiServer } from './api/server';

const logger = createLogger('main');

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const mode = CONFIG.mode;
    logger.info(`Starting in ${mode} mode`);

    const app = createApiServer();

    app.listen(CONFIG.api.port, () => {
      logger.info(`API server listening on ${CONFIG.api.host}:${CONFIG.api.port}`);
      logger.info(`Swagger documentation available at http://${CONFIG.api.host}:${CONFIG.api.port}/swagger`);
    });

    const keepAlive = setInterval(() => {
      // Keep the Bun API process alive when it is started without --watch.
    }, 60_000);

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      clearInterval(keepAlive);
      await app.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      clearInterval(keepAlive);
      await app.stop();
      process.exit(0);
    });

    await new Promise<void>(() => {});
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
