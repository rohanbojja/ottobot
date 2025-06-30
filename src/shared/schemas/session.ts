import { t } from 'elysia';

export const CreateSessionSchema = t.Object({
  initial_prompt: t.String({ 
    minLength: 1, 
    maxLength: 5000,
    description: 'The initial prompt to start the coding session'
  }),
  timeout: t.Optional(t.Number({ 
    minimum: 300, 
    maximum: 7200,
    description: 'Session timeout in seconds (default: 3600)'
  })),
  environment: t.Optional(t.String({
    enum: ['node', 'python', 'full-stack', 'data-science'],
    description: 'Development environment preset'
  }))
});

export const SessionResponseSchema = t.Object({
  session_id: t.String({
    description: 'Unique session identifier'
  }),
  status: t.String({
    enum: ['initializing', 'ready', 'running', 'terminating', 'terminated', 'error'],
    description: 'Current status of the session'
  }),
  vnc_url: t.String({
    description: 'URL to access the VNC session'
  }),
  chat_url: t.String({
    description: 'WebSocket URL for chat communication'
  }),
  created_at: t.String({
    format: 'date-time'
  }),
  expires_at: t.String({
    format: 'date-time'
  })
});

export const SessionIdParamSchema = t.Object({
  id: t.String({
    minLength: 1,
    description: 'Session ID'
  })
});

export const DownloadParamsSchema = t.Object({
  id: t.String({
    minLength: 1,
    description: 'Session ID'
  }),
  file: t.String({
    minLength: 1,
    description: 'File name to download'
  })
});

export const SessionLogsResponseSchema = t.Object({
  session_id: t.String(),
  logs: t.Array(t.Object({
    timestamp: t.String({ format: 'date-time' }),
    level: t.String(),
    message: t.String(),
    metadata: t.Optional(t.Record(t.String(), t.Any()))
  }))
});