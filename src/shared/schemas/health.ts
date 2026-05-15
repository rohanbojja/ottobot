import { t } from 'elysia';

export const HealthResponseSchema = t.Object({
  status: t.String({ 
    enum: ['healthy', 'degraded', 'unhealthy'],
    description: 'Overall system health status'
  }),
  version: t.String(),
  uptime: t.Number({
    description: 'Uptime in seconds'
  }),
  services: t.Object({
    docker: t.Boolean(),
    registry: t.Boolean(),
    sessions: t.Number({
      minimum: 0,
      description: 'Number of active sessions'
    })
  }),
  timestamp: t.String({
    format: 'date-time'
  })
});

export const MetricsResponseSchema = t.Object({
  active_sessions: t.Number({ minimum: 0 }),
  total_sessions: t.Number({ minimum: 0 }),
  timestamp: t.String({ format: 'date-time' })
});
