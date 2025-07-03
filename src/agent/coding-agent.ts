import { CONFIG } from '@/shared/config';
import { createLogger } from '@/shared/logger';
import type { ChatMessage } from '@/shared/types';
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { initChatModel } from "langchain/chat_models/universal";

const logger = createLogger('coding-agent');

export class CodingAgent {
  private sessionId: string;
  private llm?: any;
  private mcpClient: MultiServerMCPClient;
  private onMessage: (message: ChatMessage) => Promise<void>;
  private executorAgent?: ReturnType<typeof createReactAgent>;
  private checkpointer?: MemorySaver;

  private config: any;

  constructor(
    sessionId: string,
    onMessage: (message: ChatMessage) => Promise<void>,
    containerHost: string = 'localhost',
    containerPort: number = 8080
  ) {
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.config = { configurable: { thread_id: "1" } };

    // Initialize MCP client for connecting to container's MCP server
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        container: {
          url: `http://${containerHost}:${containerPort}/mcp`,
          transport: 'http' as const,
        }
      }
    });

    this.checkpointer = new MemorySaver();

  }

  private async initializeExecutor() {
    console.log("Initializing executor");

    // Retry logic for MCP connection
    const maxRetries = 30;
    const retryDelay = 1000; // 1 second
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Get MCP tools and create executor agent
        const tools = await this.mcpClient.getTools();
        this.llm?.bindTools(tools);

        this.executorAgent = createReactAgent({
          llm: this.llm as any,
          tools: tools as any,
          checkpointSaver: this.checkpointer
        });

        console.log("MCP connection established successfully");
        return; // Success, exit the retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.log(`MCP connection attempt ${i + 1}/${maxRetries} failed: ${lastError.message}`);

        // Emit status update every 5 attempts
        if ((i + 1) % 5 === 0) {
          await this.emitEvent('system_update', `Waiting for MCP server to start... (attempt ${i + 1}/${maxRetries})`);
        }

        if (i < maxRetries - 1) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // If we get here, all retries failed
    throw new Error(`Failed to connect to MCP server after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  private async emitEvent(
    type: ChatMessage['type'],
    content: string,
    metadata?: ChatMessage['metadata']
  ): Promise<void> {
    const message: ChatMessage = {
      type,
      content,
      timestamp: Date.now(),
      metadata,
    };

    await this.onMessage(message);
  }

  async processMessage(message: string): Promise<void> {
    try {
      await this.emitEvent('agent_thinking', 'Processing your request...');

      // const response = await this.executorAgent?.invoke({
      //   messages: [{ role: "user", content: message }]
      // }, this.config);

      for await (const chunk of await this.executorAgent?.stream(
        {
          messages: [{ role: "user", content: message }]
        }, {
        ...this.config
      }
      ) ?? []) {
        console.dir({ chunk }, { depth: null });

        // Handle agent messages
        if (chunk['agent'] && chunk['agent']['messages']) {
          for (const agentMessage of chunk['agent']['messages']) {
            // Handle AI messages
            if (agentMessage.content && typeof agentMessage.content === 'string') {
              // Check if it has tool calls
              if (agentMessage.tool_calls && agentMessage.tool_calls.length > 0) {
                for (const toolCall of agentMessage.tool_calls) {
                  await this.emitEvent('agent_action', `Using ${toolCall.name || toolCall.function?.name}...`, {
                    tool_used: toolCall.name || toolCall.function?.name,
                  });
                }
              } else {
                // This is a regular AI response
                await this.emitEvent('agent_response', agentMessage.content);
              }
            }
          }
        }

        // Handle tool messages (results) - these might come in different chunks
        if (chunk['tools'] && chunk['tools']['messages']) {
          for (const toolMessage of chunk['tools']['messages']) {
            if (toolMessage.content) {
              await this.emitEvent('agent_action', `Tool result: ${toolMessage.content}`, {
                tool_used: toolMessage.name,
              });
            }
          }
        }
      }

      logger.info('Agent completed processing message');
    } catch (error) {
      logger.error('Agent processing error:', error);
      await this.emitEvent('error', `Agent error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async initialize(initialPrompt?: string): Promise<void> {
    try {
      await this.emitEvent('system_update', 'Initializing agent...');
      // Initialize Gemini model
      this.llm = await initChatModel("gpt-4.1-nano", {
        modelProvider: "openai",
        apiKey: CONFIG.agent.openaiApiKey,
        temperature: 0.2,
      });


      // Initialize MCP connection and executor
      await this.initializeExecutor();

      await this.emitEvent('system_update', 'Agent initialized and ready');

      if (initialPrompt) {
        await this.processMessage(initialPrompt);
      }
    } catch (error) {
      logger.error('Agent initialization error:', error);
      await this.emitEvent('error', `Failed to initialize agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async shutdown(): Promise<void> {
    await this.emitEvent('system_update', 'Agent shutting down');
    await this.mcpClient.close();
  }
}