import { Elysia } from 'elysia';
import { HealthResponseSchema, MetricsResponseSchema } from '@/shared/schemas/health';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { CONFIG } from '@/shared/config';
import type { HealthStatus } from '@/shared/types';
import { createDockerClient } from '@/shared/docker-client';

const logger = createLogger('health-routes');
const sandboxClient = createDockerClient();
const startTime = Date.now();

export const healthRoutes = new Elysia({ prefix: '/health' })
  .get('/', async () => {
    try {
      const registryHealthy = await SessionManager.healthCheck();

      // Check sandbox runtime availability
      let sandboxHealthy = false;
      try {
        await sandboxClient.ping();
        sandboxHealthy = true;
      } catch (error) {
        logger.error('Sandbox health check failed:', error);
      }

      const activeSessions = await SessionManager.getActiveSessions();

      // Determine overall health status
      let status: HealthStatus['status'] = 'healthy';
      if (!registryHealthy || !sandboxHealthy) {
        status = 'unhealthy';
      }

      return {
        status,
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        services: {
          sandbox: sandboxHealthy,
          registry: registryHealthy,
          sessions: activeSessions.length,
        },
        agent: {
          provider: CONFIG.agent.provider,
          model: CONFIG.agent.model,
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
          sandbox: false,
          registry: false,
          sessions: 0,
        },
        agent: {
          provider: CONFIG.agent.provider,
          model: CONFIG.agent.model,
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
  .get('/metrics', async () => {
    try {
      // Get session metrics
      const sessions = await SessionManager.getActiveSessions();
      const activeSessions = sessions.length;
      
      // Get total sessions count
      const totalSessions = await SessionManager.getTotalSessionsCount();

      return {
        active_sessions: activeSessions,
        total_sessions: totalSessions,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Metrics error:', error);
      return {
        active_sessions: 0,
        total_sessions: 0,
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
      description: 'Returns metrics about local sessions',
    },
  });
