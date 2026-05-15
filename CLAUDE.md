# OttoBot Notes

This file is intentionally thin. Use `AGENTS.md` and `README.md` as the current source of truth.

Current runtime:

```text
Tauri desktop -> Elysia API -> SQLite registry -> Docker sandbox -> LangGraph agent -> MCP tools
```

There is no Redis queue, BullMQ, or separate worker process in the current local desktop architecture.
