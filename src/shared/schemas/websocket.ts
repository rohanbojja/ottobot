import { t, Static } from 'elysia';

export const UserMessageSchema = t.Object({
  type: t.Literal('user_prompt'),
  content: t.String({ 
    minLength: 1, 
    maxLength: 10000,
    description: 'User message content'
  }),
  timestamp: t.Number({
    description: 'Unix timestamp in milliseconds'
  })
});

export type UserMessageSchemaType = Static<typeof UserMessageSchema>;

export const AgentMessageSchema = t.Object({
  type: t.Union([
    t.Literal('agent_response'),
    t.Literal('agent_thinking'),
    t.Literal('agent_action'),
    t.Literal('system_update'),
    t.Literal('download_ready')
  ]),
  content: t.String(),
  timestamp: t.Number(),
  metadata: t.Optional(t.Object({
    tool_used: t.Optional(t.String()),
    progress: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
    download_url: t.Optional(t.String()),
    error: t.Optional(t.String())
  }))
});

export const WebSocketMessageSchema = t.Union([
  UserMessageSchema,
  AgentMessageSchema
]);

export const WebSocketErrorSchema = t.Object({
  type: t.Literal('error'),
  error: t.String(),
  timestamp: t.Number()
});