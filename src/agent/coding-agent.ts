import { StateGraph, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { createLogger } from '@/shared/logger';
import { CONFIG } from '@/shared/config';
import { ContextManager } from './context-manager';
import { MCPClient } from '@/mcp/client';
import type { ChatMessage } from '@/shared/types';

const logger = createLogger('coding-agent');

// Define the state interface
interface AgentState {
  messages: BaseMessage[];
  sessionId: string;
  currentTask: string | null;
  workingDirectory: string;
  context: Record<string, any>;
  error: string | null;
}

export class CodingAgent {
  private sessionId: string;
  private llm: ChatAnthropic;
  private contextManager: ContextManager;
  private graph: any;
  private mcpClient: MCPClient;
  private onMessage: (message: ChatMessage) => Promise<void>;

  constructor(
    sessionId: string,
    onMessage: (message: ChatMessage) => Promise<void>,
    containerHost: string = 'localhost',
    containerPort: number = 8080
  ) {
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    
    this.llm = new ChatAnthropic({
      apiKey: CONFIG.agent.anthropicApiKey,
      modelName: CONFIG.agent.model,
      streaming: true,
      temperature: 0.2,
    });
    
    this.contextManager = new ContextManager(sessionId);
    this.mcpClient = new MCPClient(containerHost, containerPort);
    this.graph = this.buildGraph();
  }

  private async getMCPTools() {
    try {
      await this.mcpClient.connect();
      return await this.mcpClient.getAvailableTools();
    } catch (error) {
      logger.error('Failed to get MCP tools:', error);
      return [];
    }
  }

  private async getToolDescriptions(): Promise<string> {
    const tools = await this.getMCPTools();
    return tools.map(tool => {
      const params = tool.inputSchema?.properties ? 
        Object.keys(tool.inputSchema.properties).join(', ') : 'none';
      return `- ${tool.name}: ${tool.description} (params: ${params})`;
    }).join('\n');
  }

  private buildGraph() {
    // Create a simple state graph
    const workflow = new StateGraph<AgentState>({
      channels: {
        messages: null,
        sessionId: null,
        currentTask: null,
        workingDirectory: null,
        context: null,
        error: null,
      },
    });

    // Add nodes
    workflow.addNode('process_input', this.processInput.bind(this));
    workflow.addNode('plan', this.plan.bind(this));
    workflow.addNode('execute', this.execute.bind(this));
    workflow.addNode('reflect', this.reflect.bind(this));
    workflow.addNode('respond', this.respond.bind(this));

    // Add edges
    workflow.addEdge('process_input', 'plan');
    workflow.addEdge('plan', 'execute');
    workflow.addEdge('execute', 'reflect');
    workflow.addConditionalEdges(
      'reflect',
      this.shouldContinue.bind(this),
      {
        continue: 'execute',
        respond: 'respond',
        error: 'respond',
      }
    );
    workflow.addEdge('respond', END);

    // Set entry point
    workflow.setEntryPoint('process_input');

    // Compile the workflow
    return workflow.compile();
  }

  private async processInput(state: AgentState): Promise<AgentState> {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];

    // Update context
    const context = await this.contextManager.updateContext(messages);

    // Emit thinking event
    await this.emitEvent('agent_thinking', 'Processing your request...');

    return {
      ...state,
      context,
      currentTask: lastMessage.content as string,
    };
  }

  private async plan(state: AgentState): Promise<AgentState> {
    await this.emitEvent('agent_thinking', 'Creating a plan...');

    const systemPrompt = await this.buildSystemPrompt(state);
    const planningPrompt = `
Task: ${state.currentTask}

Create a step-by-step plan to accomplish this task using the available MCP tools.
For each step that requires a tool, specify:
1. The tool name
2. The exact parameters needed
3. What you expect to accomplish

Available tools and their capabilities:
${await this.getToolDescriptions()}

Format your response as:
1. Step description
   Tool: tool_name
   Params: {"param1": "value1", "param2": "value2"}
2. Next step...

Be specific and actionable.`;

    const response = await this.llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(planningPrompt),
    ]);

    const plan = response.content;
    await this.emitEvent('agent_thinking', `Plan created: ${plan.toString().slice(0, 300)}...`);

    return {
      ...state,
      messages: [...state.messages, new AIMessage(`Plan: ${plan}`)],
    };
  }

  private async execute(state: AgentState): Promise<AgentState> {
    const action = this.extractNextAction(state);

    if (!action) {
      return state;
    }

    await this.emitEvent('agent_action', `Executing: ${action.tool}`, {
      tool_used: action.tool,
    });

    try {
      // Call tool via MCP client
      const result = await this.mcpClient.callTool(action.tool, action.params);
      
      if (result.success) {
        await this.emitEvent('agent_action', `Completed: ${action.tool}`, {
          tool_used: action.tool,
        });
        
        return {
          ...state,
          messages: [
            ...state.messages,
            new AIMessage(`Tool result: ${result.content?.slice(0, 500) || 'Success'}...`)
          ],
        };
      } else {
        return {
          ...state,
          error: `Tool failed: ${result.error}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.emitEvent('error', `Tool execution failed: ${errorMessage}`);
      return {
        ...state,
        error: errorMessage,
      };
    }
  }

  private async reflect(state: AgentState): Promise<AgentState> {
    await this.emitEvent('agent_thinking', 'Analyzing progress...');

    const reflectionPrompt = `
Based on the recent actions and results:
1. What has been accomplished?
2. What still needs to be done?
3. Should we continue with more actions or respond to the user?

Respond with ONE of the following:
- CONTINUE: if more work is needed
- RESPOND: if the task is complete or we need user input
- ERROR: if we encountered a blocking error

Your response:`;

    const response = await this.llm.invoke([
      new SystemMessage(await this.buildSystemPrompt(state)),
      new HumanMessage(reflectionPrompt),
    ]);

    const decision = response.content.toString().trim().split(':')[0].toUpperCase();
    
    return {
      ...state,
      messages: [...state.messages, new AIMessage(`Decision: ${decision}`)],
    };
  }

  private async respond(state: AgentState): Promise<AgentState> {
    await this.emitEvent('agent_thinking', 'Preparing response...');

    const responsePrompt = `
Based on everything that was done, provide a clear and helpful response to the user.
Summarize what was accomplished and any important information they should know.
Be concise but thorough.`;

    const response = await this.llm.invoke([
      new SystemMessage(await this.buildSystemPrompt(state)),
      new HumanMessage(responsePrompt),
    ]);

    const content = response.content.toString();
    await this.emitEvent('agent_response', content);

    return {
      ...state,
      messages: [...state.messages, new AIMessage(content)],
    };
  }

  private shouldContinue(state: AgentState): string {
    if (state.error) {
      return 'error';
    }

    // Look for decision in recent messages
    const recentMessages = state.messages.slice(-5);
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      if (msg instanceof AIMessage && msg.content.includes('Decision:')) {
        if (msg.content.includes('CONTINUE')) {
          return 'continue';
        } else if (msg.content.includes('ERROR')) {
          return 'error';
        } else {
          return 'respond';
        }
      }
    }

    return 'respond';
  }

  private async buildSystemPrompt(state: AgentState): Promise<string> {
    const tools = await this.getMCPTools();
    const toolList = tools.map(tool => {
      const params = tool.inputSchema?.properties ? 
        Object.keys(tool.inputSchema.properties).map(key => {
          const prop = tool.inputSchema.properties[key];
          const required = tool.inputSchema.required?.includes(key) ? ' (required)' : ' (optional)';
          return `    ${key}: ${prop.description || 'string'}${required}`;
        }).join('\n') : '    (no parameters)';
      return `- ${tool.name}: ${tool.description}\n${params}`;
    }).join('\n\n');
    
    return `You are an expert coding assistant working in an interactive development environment.

## Environment Details
- Session ID: ${state.sessionId}
- Working Directory: ${state.workingDirectory}
- Container: Ubuntu 22.04 with VS Code, Node.js, Bun, Python
- All actions are visible via VNC in real-time

## Available MCP Tools
${toolList}

## Current Context
${JSON.stringify(state.context, null, 2)}

## Instructions
1. Be helpful, thorough, and proactive
2. When planning actions, use the exact format specified for tool calls
3. All file operations happen in the container's workspace (/home/developer/workspace)
4. You can execute shell commands, read/write files, create directories, and open VS Code
5. Always verify your actions and provide clear explanations
6. If you need to use a tool, format it exactly as: "Tool: tool_name" followed by "Params: {JSON object}"

Remember: This is a live development environment where the user can see all your actions!`;
  }

  private extractNextAction(state: AgentState): { tool: string; params: any } | null {
    // Look for tool calls in recent AI messages
    const recentMessages = state.messages.slice(-3);
    
    for (const msg of recentMessages) {
      if (msg instanceof AIMessage) {
        const content = msg.content.toString();
        
        // Enhanced pattern matching for tool calls
        // Look for "Tool: tool_name" followed by "Params: {...}"
        const toolRegex = /Tool:\s*(\w+)\s*(?:\n|\r\n?)\s*Params:\s*(\{[^}]*\})/gm;
        const match = toolRegex.exec(content);
        
        if (match) {
          try {
            const toolName = match[1].trim();
            const paramsStr = match[2].trim();
            const params = JSON.parse(paramsStr);
            
            logger.info(`Extracted tool action: ${toolName}`, { params });
            return {
              tool: toolName,
              params: params,
            };
          } catch (e) {
            logger.error('Failed to parse tool params:', e);
          }
        }
        
        // Fallback: Look for common tool patterns
        if (content.includes('read_file') && content.includes('path')) {
          const pathMatch = content.match(/path[:\s]*["']([^"']+)["']/i);
          if (pathMatch) {
            return {
              tool: 'read_file',
              params: { path: pathMatch[1] }
            };
          }
        }
        
        if (content.includes('write_file') && content.includes('path')) {
          const pathMatch = content.match(/path[:\s]*["']([^"']+)["']/i);
          const contentMatch = content.match(/content[:\s]*["']([^"']+)["']/i);
          if (pathMatch && contentMatch) {
            return {
              tool: 'write_file',
              params: { path: pathMatch[1], content: contentMatch[1] }
            };
          }
        }
        
        if (content.includes('execute_command') && content.includes('command')) {
          const commandMatch = content.match(/command[:\s]*["']([^"']+)["']/i);
          if (commandMatch) {
            return {
              tool: 'execute_command',
              params: { command: commandMatch[1] }
            };
          }
        }
      }
    }

    return null;
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
    const initialState: AgentState = {
      messages: [new HumanMessage(message)],
      sessionId: this.sessionId,
      currentTask: message,
      workingDirectory: '/home/developer/workspace',
      context: {},
      error: null,
    };

    const config = {
      configurable: { thread_id: this.sessionId },
    };

    try {
      await this.graph.invoke(initialState, config);
    } catch (error) {
      logger.error('Agent processing error:', error);
      await this.emitEvent('error', `Agent error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async initialize(initialPrompt?: string): Promise<void> {
    await this.emitEvent('system_update', 'Agent initialized and ready');

    if (initialPrompt) {
      await this.processMessage(initialPrompt);
    }
  }

  async shutdown(): Promise<void> {
    await this.emitEvent('system_update', 'Agent shutting down');
    this.mcpClient.disconnect();
  }
}