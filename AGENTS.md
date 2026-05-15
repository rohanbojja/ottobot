# OttoBot Agent Notes

## Project Shape

OttoBot is a Bun, TypeScript, and Tauri coding-agent platform. The backend exposes an Elysia API, SQLite-backed session/container registry, Docker sandbox lifecycle, WebSocket chat, and MCP-backed tool execution inside sandbox containers. The desktop cockpit lives in `frontend/` with React/Vite/shadcn-style components.

The current runtime shape is:

```text
User -> Tauri desktop -> Elysia API -> SQLite registry
                                  -> Docker session container
                                  -> LangGraph agent -> MCP server in container
```

Keep changes aligned with this boundary: no Redis queue, no BullMQ, and no separate worker process. Session creation, termination, chat processing, registry writes, and agent lifecycle all happen in the local API process supervised by Tauri.

## Commands

Run backend commands from the repo root:

```bash
bun install
bun run typecheck
bun run dev:api
bun run build
```

Run desktop/frontend commands from the repo root:

```bash
bun run desktop:dev
bun run desktop:build
bun run desktop:check
```

Run frontend-only commands from `frontend/`:

```bash
bun install
bun run check
bun run build
bun run dev
```

Local session development needs Docker running. The agent image must exist before session creation can work:

```bash
docker build -f docker/Dockerfile.agent -t ottobot-agent .
```

## Environment

Copy `.env.example` to `.env` for local development and provide at least one model API key:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`

Other important settings include `LLM_MODEL`, `OTTOBOT_SQLITE_PATH`, VNC port range `6080-6200`, MCP port range `8080-8200`, and `AGENT_IMAGE`.

Do not commit `.env`, `node_modules`, `dist`, `session-data`, or temporary local runtime files.

## Backend Conventions

- Use Bun APIs and scripts; do not assume Node-only runtime behavior.
- Keep TypeScript strict. The root `tsconfig.json` enables unused checks, strict null checks, no implicit returns, and indexed-access checks.
- Prefer existing `@/` imports for backend source files.
- Use Elysia schemas and response metadata for API endpoints so OpenAPI generation stays useful.
- Route WebSocket messages through `SessionRouter` and keep message shapes aligned with `src/shared/schemas/websocket.ts`.
- Use the Winston logger in `src/shared/logger.ts`; avoid adding raw `console.log` in app code.
- On container/session failures, update session state, log context, and clean up containers and allocated ports.
- Keep new agent tool behavior on the MCP path. `src/agent/coding-agent.ts` uses LangChain's `MultiServerMCPClient` to connect to the container MCP server; `src/mcp/server.ts` owns the container-side tools.

## Desktop And Frontend Conventions

- The desktop shell lives under `src-tauri/` and uses Tauri 2 with a React/Vite frontend.
- The frontend lives under `frontend/` and uses React, Tailwind, and shadcn-style components copied from the desk template reference.
- Keep API access in a small frontend client module and keep Tauri commands in a separate bridge module.
- Preserve the session UX contract: dashboard lists sessions, session detail shows chat plus VNC access, and chat should handle reconnects and smooth new-message behavior.
- # TODO: Consider Firecracker VM isolation after the Docker session lifecycle and MCP tool contracts are stable.

## Verification

For backend changes, run:

```bash
bun run typecheck
```

For frontend changes, run:

```bash
cd frontend
bun run check
bun run build
```

For desktop shell changes, also run:

```bash
bun run desktop:check
```

Container/session behavior cannot be considered verified unless Docker is running and the `ottobot-agent` image has been built.

## Useful Files

- `README.md`: product overview, setup, and API usage.
- `CLAUDE.md`: older assistant-oriented repo notes; verify against this file before trusting it.
- `docs/ARCHITECTURE-MERMAID.md`: architecture diagrams and flows.
- `src/index.ts`: API process entry point.
- `src/api/server.ts`: API composition.
- `src/application/session-orchestrator.ts`: session lifecycle orchestration.
- `src/application/adapters/docker-container-manager.ts`: Docker lifecycle and port handling.
- `src/shared/session-manager.ts`: SQLite-backed session registry.
- `src/mcp/server.ts`: container-side MCP tools.
- `src-tauri/`: Tauri desktop shell and local service supervisor commands.
- `frontend/src/`: React desktop cockpit for dashboard, runtime health, chat, VNC, and downloads.
