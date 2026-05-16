import { CodingAgent } from "@/agent/coding-agent";
import type { AgentEvent, AgentRuntime, AgentRuntimeFactory } from "@/application/ports";
import type { UIMessage } from "ai";

class AiSdkAgentRuntime implements AgentRuntime {
  constructor(private readonly agent: CodingAgent) {}

  initialize(initialPrompt?: string): Promise<void> {
    return this.agent.initialize(initialPrompt);
  }

  streamMessages(
    messages: UIMessage[],
    options?: {
      abortSignal?: AbortSignal;
      onFinish?: (messages: UIMessage[]) => Promise<void>;
    },
  ): Promise<Response> {
    return this.agent.streamMessages(messages, options);
  }

  shutdown(): Promise<void> {
    return this.agent.shutdown();
  }
}

export class AiSdkAgentRuntimeFactory implements AgentRuntimeFactory {
  create(input: {
    sessionId: string;
    mcpHost: string;
    mcpPort: number;
    emit: (event: AgentEvent) => Promise<void>;
  }): AgentRuntime {
    const agent = new CodingAgent(
      input.sessionId,
      input.emit,
      input.mcpHost,
      input.mcpPort,
    );

    return new AiSdkAgentRuntime(agent);
  }
}
