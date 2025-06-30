import { Elysia } from 'elysia';
import { Queue } from 'bullmq';
import { redis } from './redis';
import { createLogger } from '@/shared/logger';
import type { WorkerJob } from '@/shared/types';

const logger = createLogger('queue');

export const sessionQueue = new Queue<WorkerJob>('sessions', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const queuePlugin = new Elysia({ name: 'queue' })
  .decorate('queue', sessionQueue)
  .onStop(async () => {
    logger.info('Closing queue connection');
    await sessionQueue.close();
  });