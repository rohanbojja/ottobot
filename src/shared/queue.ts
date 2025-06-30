import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG } from './config';
import type { WorkerJob } from './types';

// Create Redis connection for BullMQ
export function createRedisConnection() {
  return new Redis({
    host: CONFIG.redis.host,
    port: CONFIG.redis.port,
    password: CONFIG.redis.password,
    maxRetriesPerRequest: null, // Required for BullMQ
  });
}

// Queue names
export const QUEUE_NAMES = {
  sessions: 'sessions',
  artifacts: 'artifacts',
} as const;

// Job names
export const JOB_NAMES = {
  createSession: 'create_session',
  terminateSession: 'terminate_session',
  processMessage: 'process_message',
  createArtifact: 'create_artifact',
} as const;

// Create a sessions queue instance
export function createSessionQueue() {
  return new Queue<WorkerJob>(QUEUE_NAMES.sessions, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 1000,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  });
}

// Create queue events instance for monitoring
export function createQueueEvents(queueName: string) {
  return new QueueEvents(queueName, {
    connection: createRedisConnection(),
  });
}

// Session assignment using consistent hashing
export function getWorkerIdForSession(sessionId: string, workerCount: number): string {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    const char = sessionId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  const workerIndex = Math.abs(hash) % workerCount;
  return `worker-${workerIndex}`;
}