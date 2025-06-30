import { StateGraph, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { createLogger } from '@/shared/logger';
import { CONFIG } from '@/shared/config';
import { ContextManager } from './context-manager';
import * as tools from './tools';
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
  private tools: Record<string, any>;
  private onMessage: (message: ChatMessage) => Promise<void>;

  constructor(
    sessionId: string,
    onMessage: (message: ChatMessage) => Promise<void>
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
    this.tools = this.setupTools();
    this.graph = this.buildGraph();
  }

  private setupTools() {
    return {
      bash_execute: tools.bashExecute,
      file_write: tools.fileWrite,
      file_read: tools.fileRead,
      file_list: tools.fileList,
      project_structure: tools.projectStructure,
      git_operations: tools.gitOperations,
      package_install: tools.packageInstall,
      create_artifact: tools.createArtifact,
      browser_open: tools.browserOpen,
      process_monitor: tools.processMonitor,
    };
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

    const systemPrompt = this.buildSystemPrompt(state);
    const planningPrompt = `
Task: ${state.currentTask}

Create a step-by-step plan to accomplish this task.
Consider the current context and available tools.
Be specific about what needs to be done.
Format your response as a numbered list of steps.`;

    const response = await this.llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(planningPrompt),
    ]);

    const plan = response.content;
    await this.emitEvent('agent_thinking', `Plan created: ${plan.slice(0, 200)}...`);

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
      const toolFunc = this.tools[action.tool];
      if (toolFunc) {
        const result = await toolFunc(action.params);
        
        await this.emitEvent('agent_action', `Completed: ${action.tool}`, {
          tool_used: action.tool,
        });
        
        return {
          ...state,
          messages: [
            ...state.messages,
            new AIMessage(`Tool result: ${JSON.stringify(result).slice(0, 500)}...`)
          ],
        };
      } else {
        return {
          ...state,
          error: `Unknown tool: ${action.tool}`,
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
      new SystemMessage(this.buildSystemPrompt(state)),
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
      new SystemMessage(this.buildSystemPrompt(state)),
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

  private buildSystemPrompt(state: AgentState): string {
    return `You are an expert coding assistant working in an interactive development environment.

Session ID: ${state.sessionId}
Working Directory: ${state.workingDirectory}

Available tools:
- bash_execute: Run shell commands
- file_write: Create or modify files
- file_read: Read file contents
- file_list: List directory contents
- project_structure: Analyze project structure
- git_operations: Perform git operations
- package_install: Install packages (npm, pip, etc.)
- create_artifact: Package project for download
- browser_open: Open URLs in browser
- process_monitor: Monitor running processes

Context:
${JSON.stringify(state.context, null, 2)}

Be helpful, thorough, and proactive in accomplishing the user's goals.
When executing tools, always provide the exact parameters needed.`;
  }

  private extractNextAction(state: AgentState): { tool: string; params: any } | null {
    // Look for tool calls in recent AI messages
    const recentMessages = state.messages.slice(-5);
    
    for (const msg of recentMessages) {
      if (msg instanceof AIMessage) {
        // Simple pattern matching for tool calls
        // In production, use proper tool calling with the LLM
        const toolMatch = msg.content.match(/Tool: (\w+)\nParams: ({.*})/s);
        if (toolMatch) {
          try {
            return {
              tool: toolMatch[1],
              params: JSON.parse(toolMatch[2]),
            };
          } catch (e) {
            logger.error('Failed to parse tool params:', e);
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
    // Cleanup resources if needed
  }
}