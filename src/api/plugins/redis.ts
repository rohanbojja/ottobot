import { Elysia } from 'elysia';
import Redis from 'ioredis';
import { CONFIG } from '@/shared/config';
import { createLogger } from '@/shared/logger';

const logger = createLogger('redis');

export const redis = new Redis({
  host: CONFIG.redis.host,
  port: CONFIG.redis.port,
  password: CONFIG.redis.password,
  maxRetriesPerRequest: CONFIG.redis.maxRetriesPerRequest,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn(`Redis connection failed, retrying in ${delay}ms...`);
    return delay;
  }
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

redis.on('error', (error) => {
  logger.error('Redis error:', error);
});

export const redisPlugin = new Elysia({ name: 'redis' })
  .decorate('redis', redis)
  .onStop(async () => {
    logger.info('Closing Redis connection');
    await redis.quit();
  });