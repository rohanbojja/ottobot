import { Elysia } from 'elysia';
import { HealthResponseSchema, MetricsResponseSchema } from '@/shared/schemas/health';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import type { HealthStatus } from '@/shared/types';
import Docker from 'dockerode';

const logger = createLogger('health-routes');
const docker = new Docker();
const startTime = Date.now();

export const healthRoutes = new Elysia({ prefix: '/health' })
  .get('/', async ({ redis }) => {
    try {
      // Check Redis
      let redisHealthy = false;
      try {
        await redis.ping();
        redisHealthy = true;
      } catch (error) {
        logger.error('Redis health check failed:', error);
      }

      // Check Docker
      let dockerHealthy = false;
      try {
        await docker.ping();
        dockerHealthy = true;
      } catch (error) {
        logger.error('Docker health check failed:', error);
      }

      // Count active workers
      const workerKeys = await redis.keys('worker:*:status');
      let activeWorkers = 0;
      for (const key of workerKeys) {
        const status = await redis.get(key);
        if (status === 'active') activeWorkers++;
      }

      // Determine overall health status
      let status: HealthStatus['status'] = 'healthy';
      if (!redisHealthy || !dockerHealthy) {
        status = 'unhealthy';
      } else if (activeWorkers === 0) {
        status = 'degraded';
      }

      return {
        status,
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        services: {
          redis: redisHealthy,
          docker: dockerHealthy,
          workers: activeWorkers,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Health check error:', error);
      return {
        status: 'unhealthy' as const,
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        services: {
          redis: false,
          docker: false,
          workers: 0,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }, {
    response: {
      200: HealthResponseSchema
    },
    detail: {
      tags: ['health'],
      summary: 'System health check',
      description: 'Returns the health status of the system and its dependencies',
    },
  })
  .get('/metrics', async ({ queue, redis }) => {
    try {
      // Get session metrics
      const sessions = await SessionManager.getActiveSessions();
      const activeSessions = sessions.length;
      
      // Get total sessions count
      const totalSessionsCount = await redis.get('metrics:total_sessions');
      const totalSessions = totalSessionsCount ? parseInt(totalSessionsCount, 10) : 0;

      // Get queue metrics
      const queueStatus = await queue.getJobCounts();
      const queueLength = queueStatus.waiting + queueStatus.active;

      // Get worker status
      const workerKeys = await redis.keys('worker:*:status');
      const workerStatus = [];
      
      for (const key of workerKeys) {
        const workerId = key.split(':')[1];
        const status = await redis.get(key);
        const jobsKey = `worker:${workerId}:jobs`;
        const jobs = await redis.scard(jobsKey);
        
        workerStatus.push({
          id: workerId,
          active: status === 'active',
          current_jobs: jobs,
        });
      }

      return {
        active_sessions: activeSessions,
        total_sessions: totalSessions,
        queue_length: queueLength,
        worker_status: workerStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Metrics error:', error);
      return {
        active_sessions: 0,
        total_sessions: 0,
        queue_length: 0,
        worker_status: [],
        timestamp: new Date().toISOString(),
      };
    }
  }, {
    response: {
      200: MetricsResponseSchema
    },
    detail: {
      tags: ['health'],
      summary: 'System metrics',
      description: 'Returns metrics about sessions, queues, and workers',
    },
  });