import { CodingAgent } from "@/agent/coding-agent";
import type { AgentEvent, AgentRuntime, AgentRuntimeFactory } from "@/application/ports";
import type { ChatMessage } from "@/shared/types";

class LangGraphAgentRuntime implements AgentRuntime {
  constructor(private readonly agent: CodingAgent) {}

  initialize(initialPrompt?: string): Promise<void> {
    return this.agent.initialize(initialPrompt);
  }

  processMessage(message: string): Promise<void> {
    return this.agent.processMessage(message);
  }

  shutdown(): Promise<void> {
    return this.agent.shutdown();
  }
}

function toAgentEvent(message: ChatMessage): AgentEvent {
  switch (message.type) {
    case "agent_thinking":
      return { type: "thinking", content: message.content, metadata: message.metadata };
    case "agent_response":
      return { type: "response", content: message.content, metadata: message.metadata };
    case "agent_action":
      return {
        type: "tool_call",
        content: message.content,
        toolName: typeof message.metadata?.tool_used === "string" ? message.metadata.tool_used : undefined,
        metadata: message.metadata,
      };
    case "error":
      return { type: "error", content: message.content, metadata: message.metadata };
    case "system_update":
    case "download_ready":
    case "user_prompt":
      return { type: "system", content: message.content, metadata: message.metadata };
  }
}

export class LangGraphAgentRuntimeFactory implements AgentRuntimeFactory {
  create(input: {
    sessionId: string;
    mcpHost: string;
    mcpPort: number;
    emit: (event: AgentEvent) => Promise<void>;
  }): AgentRuntime {
    const agent = new CodingAgent(
      input.sessionId,
      async (message) => input.emit(toAgentEvent(message)),
      input.mcpHost,
      input.mcpPort,
    );

    return new LangGraphAgentRuntime(agent);
  }
}
