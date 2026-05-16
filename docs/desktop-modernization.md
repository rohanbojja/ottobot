# OttoBot Desktop Modernization

OttoBot is now desktop-first with a Tauri shell and a React/shadcn cockpit. The runtime path is intentionally small:

```text
Tauri desktop -> Elysia API -> SQLite registry -> WorkspaceSession -> SandboxBackend -> MCP tools -> agent
```

## Current V1 Boundary

- Tauri owns the local cockpit window and can check/start/stop the API.
- Docker remains the external sandbox runtime.
- SQLite is the local session/container registry.
- There is no Redis queue, BullMQ, or separate worker process.
- Session dashboard, chat, VNC, downloads, and runtime health remain the user-facing contract.

## Swap Ports

- `AgentRuntime`: initialize, stream AI SDK UI messages, emit normalized events, and shut down without binding orchestration code to a specific provider.
- `WorkspaceSession`: user-facing isolation boundary; scratch workspace now, git worktree next.
- `SandboxBackend`: create/start/stop/log execution sandboxes without binding orchestration code to Dockerode, E2B, Daytona, Apple Container, or Firecracker.
- `SessionOrchestrator`: own session state transitions and failure cleanup.
- `ToolServer`: split MCP registration from concrete file, command, editor, GUI, process, and download tools.

## TODO Scan Anchors

- # TODO: Replace raw Tauri child-process supervision with a persistent supervisor that stores logs and exit reasons.
- # TODO: Add a git worktree manager before letting sessions mutate a user's source repo.
- # TODO: Add a warm Docker sandbox pool behind `SandboxBackend` before replacing Docker.
- # TODO: Consider Firecracker VM isolation once the local sandbox/MCP loop is stable and session cleanup is proven.
- # TODO: Add contract tests for agent event normalization and session cleanup.

## Boot Speed Direction

See `docs/session-boot-strategy.md` and `docs/worktree-sandbox-architecture.md`. The current cleanup keeps Docker because it already matches the MCP/VNC sandbox contract, but Create now prepares the API and first-run agent image before booting the session directly. The next speed win is a warm sandbox pool and worktree-backed sessions behind `SandboxBackend`.
