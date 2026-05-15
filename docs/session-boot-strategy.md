# Session Boot Strategy

## Decision

Keep Docker for the current desktop milestone, but keep it behind `SandboxBackend`. Use SQLite for the local session/container registry and boot sessions directly from the local API process.

## Current Pass

- Create checks Docker, the agent image, and the local API.
- The API allocates VNC/MCP ports, creates the workspace, starts the Docker sandbox, records it in SQLite, and starts the agent.
- The UI shows each warmup stage instead of failing with a generic fetch error.
- Session view shows the resulting sandbox and chat state from the SQLite-backed API.

## Why Not Switch Runtime Yet

- Apple Container is interesting for macOS-native Linux containers, but OttoBot currently depends on VNC/noVNC, MCP port mapping, workspace mounts, and image build behavior that Docker already satisfies.
- A runtime swap should happen behind `SandboxBackend`, after the session lifecycle is stable and measured.
- Firecracker remains the stronger isolation candidate later, but it is a bigger product and ops commitment than the current desktop POC needs.

## Next Speed Work

- # TODO: Add a `SandboxBackend.prepare()` or warm-pool contract that keeps one stopped/ready sandbox available.
- # TODO: Add a worktree manager so user repos are edited through isolated branches/worktrees instead of direct mutation.
- # TODO: Measure cold image build, API startup, container create, VNC ready, MCP ready, agent initialize, and first agent token separately.
- # TODO: Consider Apple Container only after the Docker adapter has a parity test for workspace mounts, VNC, MCP, port allocation, logs, stop/remove, and downloads.
- # TODO: Consider Firecracker after the runtime contract can support VM lifecycle, snapshots, and cleanup without changing the UI.
