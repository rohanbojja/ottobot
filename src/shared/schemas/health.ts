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
    redis: t.Boolean(),
    docker: t.Boolean(),
    workers: t.Number({
      minimum: 0,
      description: 'Number of active workers'
    })
  }),
  timestamp: t.String({
    format: 'date-time'
  })
});

export const MetricsResponseSchema = t.Object({
  active_sessions: t.Number({ minimum: 0 }),
  total_sessions: t.Number({ minimum: 0 }),
  queue_length: t.Number({ minimum: 0 }),
  worker_status: t.Array(t.Object({
    id: t.String(),
    active: t.Boolean(),
    current_jobs: t.Number({ minimum: 0 })
  })),
  timestamp: t.String({ format: 'date-time' })
});