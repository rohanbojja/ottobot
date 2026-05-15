# OttoBot

OttoBot is a local-first Tauri desktop coding-agent cockpit. The desktop shell supervises the local API, the API owns session/container lifecycle directly, and session state is stored in a small SQLite registry.

## Runtime Shape

```text
Tauri desktop -> Elysia API -> SQLite session registry
                          -> Docker sandbox container
                          -> LangGraph agent -> MCP server in container
```

There is no Redis queue and no separate worker process. Creating a session allocates ports, starts a Docker sandbox, records it in SQLite, and starts the agent in the local API process.

## Tech Stack

- Bun + TypeScript
- Elysia HTTP/WebSocket API
- Tauri 2 desktop shell
- React/Vite/Tailwind frontend in `frontend/`
- Bun SQLite registry at `session-data/ottobot.sqlite`
- Docker sandbox image with VNC/noVNC and MCP tools
- LangGraph agent runtime for now

## Quick Start

```bash
bun install
cp .env.example .env
docker build -f docker/Dockerfile.agent -t ottobot-agent .
bun run dev
```

`bun run dev` launches the Tauri desktop shell. Settings can start the local API and configure the Docker agent image. Docker must already be running, and at least one model API key should be present in `.env`.

Useful commands:

```bash
bun run dev:api
bun run typecheck
cd frontend && bun run check
bun run desktop:check
bun run build
```

## Environment

Important settings:

- `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`
- `LLM_MODEL`
- `OTTOBOT_SQLITE_PATH`
- `VNC_PORT_RANGE_START` / `VNC_PORT_RANGE_END`
- `VNC_RESOLUTION`
- `MCP_PORT_RANGE_START` / `MCP_PORT_RANGE_END`
- `AGENT_IMAGE`

Do not commit `.env`, `node_modules`, `dist`, `session-data`, or local runtime logs.

## API

- `POST /session` creates a local sandbox session directly.
- `GET /session` lists active sessions from SQLite.
- `GET /session/:id` returns session status.
- `DELETE /session/:id` stops/removes the sandbox and marks the session terminated.
- `GET /session/:id/logs` returns session logs.
- `WS /session/:id/chat` sends chat messages to the local agent.
- `GET /download/:id` proxies the container workspace download.
- `GET /health` reports SQLite and Docker health.
- `GET /health/metrics` reports session counts.

## Source Map

```text
src/api/                     Elysia routes and WebSocket handler
src/application/             Session orchestration and swappable runtime ports
src/application/adapters/    SQLite store, Docker sandbox, LangGraph runtime
src/agent/                   Coding agent
src/mcp/                     Container-side MCP server
src/shared/                  Config, schemas, registry, router, types
src-tauri/                   Tauri shell and local API supervisor
frontend/src/                Desktop cockpit UI
```

## Verification

For backend changes:

```bash
bun run typecheck
bun run build
```

For frontend changes:

```bash
cd frontend
bun run check
bun run build
```

For desktop changes:

```bash
bun run desktop:check
```

Container/session behavior is only verified when Docker is running, the `ottobot-agent` image exists, and a session can create a Docker sandbox.
