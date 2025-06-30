import winston from 'winston';
import { CONFIG } from './config';

const logFormat = CONFIG.logging.format === 'json'
  ? winston.format.json()
  : winston.format.simple();

export const logger = winston.createLogger({
  level: CONFIG.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Create child loggers for different modules
export const createLogger = (module: string) => {
  return logger.child({ module });
};