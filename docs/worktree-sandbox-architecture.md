# Worktree + Sandbox Architecture

## Decision

OttoBot should model a session as a workspace first and a sandbox second.
The user-facing isolation primitive is a git worktree or scratch workspace. The
sandbox is only the execution backend that runs commands, hosts MCP tools, and
optionally exposes a desktop stream.

```text
User repo
  -> WorkspaceSession (scratch now, git worktree next)
  -> SandboxBackend (Docker now; Apple Container, E2B, Daytona, Firecracker later)
  -> MCP tools + agent runtime
  -> review diff / download workspace / merge intentionally
```

## Contracts

- `WorkspaceManager` creates the session workspace.
- `WorkspaceSession` describes the host path and sandbox path the agent works in.
- `SandboxBackend` owns create/start/ready/log/stop/destroy lifecycle.
- Docker is implemented as `DockerSandboxBackend`; `containerId` remains a
  persisted compatibility field until session storage is migrated to `sandboxId`.
- The orchestrator must depend on `SandboxBackend`, not Dockerode, Docker
  containers, cloud sandboxes, or VM-specific concepts.

## Backend Expectations

Every future backend must provide the same behavior:

- mount or sync the `WorkspaceSession` into the sandbox working directory
- expose MCP over a known host/port or equivalent endpoint
- expose VNC/noVNC only when the UI needs a visible desktop
- provide logs and deterministic cleanup
- preserve session output so the user can review or export the diff

## Near-Term Path

Keep Docker as backend v1 because it already satisfies VNC, MCP, port mapping,
workspace mounts, logs, and cleanup. The next product improvement is adding a
real worktree manager and warm Docker sandbox pool, not swapping to E2B,
Daytona, Apple Container, or Firecracker first.
