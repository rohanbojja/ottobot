# Claude Development Assistant Guide

This document contains important context and instructions for Claude when working on the OttoBot project.

## Project Overview

OttoBot is an interactive coding agent platform that allows users to:
- Create persistent coding sessions in isolated Docker containers
- Interact with an AI agent via WebSocket chat
- Watch the agent work in real-time through VNC
- Download completed projects

## Architecture Summary

```
User → API Server (Elysia) → Worker Processes → Agent Containers (VNC + LangGraph)
              ↓                     ↓
           Redis Queue        Docker + WebSocket
```

## Key Technologies

- **Runtime**: Bun (not Node.js) - Use Bun-specific APIs where applicable
- **Language**: TypeScript with strict mode enabled
- **API Framework**: Elysia (not Express/Fastify)
- **Queue**: BullMQ with Redis
- **AI**: LangGraph (TypeScript) + Anthropic Claude
- **Containers**: Docker with VNC access via noVNC

## Development Commands

Always run these commands to ensure code quality:

```bash
# Type checking (run after making changes)
bun run typecheck

# Start development servers
bun run dev:api     # API server
bun run dev:worker  # Worker process

# Docker commands
docker-compose up -d              # Production
docker-compose -f docker-compose.dev.yml up -d  # Development
```

## Code Style Guidelines

1. **TypeScript Strict Mode**: All code must pass strict TypeScript checks
2. **Error Handling**: Always use try-catch blocks and log errors appropriately
3. **Async/Await**: Prefer async/await over callbacks or raw promises
4. **Imports**: Use `@/` path alias for src imports (e.g., `@/shared/types`)
5. **Logging**: Use the configured Winston logger, not console.log

## Project Structure

```
src/
├── api/          # Elysia API server code
│   ├── routes/   # HTTP endpoints
│   ├── websocket/# WebSocket handlers
│   └── plugins/  # Elysia plugins (Redis, Queue)
├── worker/       # Worker process code
│   ├── worker.ts # Main worker class
│   ├── session-handler.ts # Session lifecycle
│   └── container-manager.ts # Docker operations
├── agent/        # LangGraph agent code
│   ├── coding-agent.ts # Main agent logic
│   ├── tools.ts  # Agent tool implementations
│   └── context-manager.ts # Token management
├── shared/       # Shared code
│   ├── types.ts  # TypeScript interfaces
│   ├── schemas/  # Elysia validation schemas
│   ├── config.ts # Configuration
│   └── logger.ts # Logging setup
└── index.ts      # Entry point
```

## Common Patterns

### Adding New API Endpoints

```typescript
// In src/api/routes/[route-name].ts
import { Elysia } from 'elysia';
import { t } from 'elysia'; // For schemas

export const myRoutes = new Elysia({ prefix: '/my-route' })
  .get('/', async ({ query }) => {
    // Implementation
  }, {
    query: t.Object({ /* schema */ }),
    response: t.Object({ /* schema */ }),
    detail: { tags: ['category'], summary: 'Description' }
  });
```

### Adding New Agent Tools

```typescript
// In src/agent/tools.ts
export async function myTool(params: {
  param1: string;
  param2?: number;
}): Promise<ToolResult> {
  try {
    // Implementation
    return { success: true, output: 'result' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### Working with Redis

```typescript
import { redis } from '@/api/plugins/redis';

// Store with TTL
await redis.setex('key', 3600, JSON.stringify(data));

// Get and parse
const data = await redis.get('key');
const parsed = data ? JSON.parse(data) : null;
```

## Important Considerations

1. **Container Security**: 
   - Containers run with limited resources (2GB RAM, 1 CPU)
   - Use non-root user (developer) in containers
   - Network isolation between sessions

2. **Session Management**:
   - Sessions expire after timeout (default 1 hour)
   - VNC ports are dynamically allocated (6080-6200)
   - Use consistent hashing for worker assignment

3. **WebSocket Communication**:
   - All messages must follow defined schemas
   - Use SessionRouter for pub/sub between workers
   - Handle disconnections gracefully

4. **Error Handling**:
   - Always update session status on errors
   - Log errors with appropriate context
   - Clean up resources (containers, ports) on failure

## Testing Checklist

When making changes, ensure:

- [ ] TypeScript compilation passes (`bun run typecheck`)
- [ ] API endpoints have proper validation schemas
- [ ] Error cases are handled with appropriate status codes
- [ ] Resources are cleaned up properly (containers, Redis keys)
- [ ] Logs provide useful debugging information
- [ ] WebSocket messages follow the defined format

## Common Issues and Solutions

1. **Port Conflicts**: Check if VNC ports are already in use
2. **Container Startup**: Ensure Docker daemon is running
3. **Redis Connection**: Verify Redis is accessible at configured host/port
4. **TypeScript Errors**: Run `bun run typecheck` to identify issues

## Environment Variables

Key environment variables that must be set:

- `ANTHROPIC_API_KEY` - Required for AI agent
- `MODE` - Either 'api' or 'worker'
- `REDIS_HOST/PORT` - Redis connection
- `CONTAINER_NETWORK` - Docker network name

## Debugging Tips

1. Check logs in respective modules (API, Worker, Agent)
2. Monitor Redis keys with `redis-cli MONITOR`
3. Inspect Docker containers with `docker ps` and `docker logs`
4. Use the `/health` endpoint to check system status
5. WebSocket issues can be debugged with browser DevTools

## Future Enhancements to Consider

- Authentication and authorization
- Persistent file storage (S3/MinIO)
- Multi-model support (GPT-4, etc.)
- Session recording and playback
- Collaborative sessions
- Custom container images per environment