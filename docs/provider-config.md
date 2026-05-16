# Provider Config

OttoBot now treats model access as provider configuration instead of a hard-coded
environment-only concern.

## Current Pass

- UI: the desktop Settings tab manages the active provider and model.
- Auth: direct provider API keys stay in the process environment; Codex CLI uses
  the local `codex login` state.
- Storage: Tauri persists provider preferences in the app config directory as
  `provider-config.json`.
- Runtime: when the desktop starts the managed API process, it injects
  `LLM_PROVIDER`, `LLM_MODEL`, and optional Codex CLI path/cwd values from
  `provider-config.json`.

## Codex OAuth

Codex OAuth uses the local Codex CLI login state. OttoBot checks:

```bash
codex login status
```

The setup action opens a Terminal flow:

```bash
codex login --device-auth
```

This keeps ChatGPT OAuth tokens owned by the Codex CLI instead of storing them in
OttoBot.

To run the backend through the Codex CLI provider:

```bash
LLM_PROVIDER=codex-cli
LLM_MODEL=gpt-5.5
```

`CODEX_CLI_PATH` can point at a specific Codex binary, and `CODEX_CLI_CWD` can
override the host working directory used by the spawned `codex exec` process.
OttoBot configures Codex CLI with `approvalMode=never`, `sandboxMode=read-only`,
and the selected session's HTTP MCP server, so file and command actions still go
through the disposable sandbox boundary.

## AI SDK Shape

AI SDK v6 supports this provider model:

- Codex CLI: `ai-sdk-provider-codex-cli`
- Moonshot AI: `@ai-sdk/moonshotai`
- OpenAI-compatible endpoints: `@ai-sdk/openai-compatible`

OpenCode uses the same general shape: credentials are separate from provider
config, and custom OpenAI-compatible providers declare an AI SDK package,
`options.baseURL`, and a model map.

## Kimi Coding Plan

Kimi Code membership and the Kimi Platform are separate auth surfaces.

For Kimi Code membership:

```json
{
  "providerPackage": "@ai-sdk/openai-compatible",
  "baseUrl": "https://api.kimi.com/coding/v1",
  "model": "kimi-for-coding",
  "authMode": "api-key"
}
```

For Moonshot platform API keys:

```json
{
  "providerPackage": "@ai-sdk/moonshotai",
  "baseUrl": "https://api.moonshot.ai/v1",
  "model": "kimi-k2.5",
  "authMode": "api-key"
}
```

## Runtime Direction

The current runtime uses a direct provider selection path:

```text
Settings tab -> provider-config.json -> managed API env -> AI SDK provider instance -> ToolLoopAgent
```

Manual `bun run dev:api` runs still use shell environment values directly. That
keeps provider setup independent from the container, registry, and MCP contracts
while letting the desktop cockpit own the normal local runtime path.

## References

- AI SDK Codex CLI provider: https://ai-sdk.dev/providers/community-providers/codex-cli
- AI SDK Moonshot AI provider: https://ai-sdk.dev/providers/ai-sdk-providers/moonshotai
- AI SDK OpenAI-compatible provider: https://ai-sdk.dev/providers/openai-compatible-providers
- OpenCode provider config: https://opencode.ai/docs/providers
- Kimi API overview: https://platform.kimi.ai/docs/api/overview
- Kimi Code FAQ: https://www.kimi.com/code/docs/en/kimi-code/faq.html
