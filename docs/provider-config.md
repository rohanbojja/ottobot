# Provider Config

OttoBot now treats model access as provider configuration instead of a hard-coded
environment-only concern.

## Current Pass

- UI: the desktop `Providers` tab manages local provider preferences.
- Auth: Codex OAuth is the only actionable setup path for now.
- Storage: Tauri persists provider preferences in the app config directory as
  `provider-config.json`.
- Runtime: the existing LangGraph agent still constructs its model directly.

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

## Next Runtime Step

When we replace the LangGraph model construction, add an `AgentModelProvider`
registry that can resolve:

```text
ProviderConfig -> AI SDK provider instance -> AgentRuntime
```

That keeps provider setup independent from the container, registry, and MCP contracts.

## References

- AI SDK Codex CLI provider: https://ai-sdk.dev/providers/community-providers/codex-cli
- AI SDK Moonshot AI provider: https://ai-sdk.dev/providers/ai-sdk-providers/moonshotai
- AI SDK OpenAI-compatible provider: https://ai-sdk.dev/providers/openai-compatible-providers
- OpenCode provider config: https://opencode.ai/docs/providers
- Kimi API overview: https://platform.kimi.ai/docs/api/overview
- Kimi Code FAQ: https://www.kimi.com/code/docs/en/kimi-code/faq.html
