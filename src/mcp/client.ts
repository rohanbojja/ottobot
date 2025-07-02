import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '@/shared/logger';

const logger = createLogger('mcp-client');

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCallResult {
  success: boolean;
  content?: string;
  error?: string;
}

export class MCPClient {
  private client: Client;
  private transport: HTTPClientTransport | null = null;
  private isConnected = false;
  private availableTools: MCPTool[] = [];
  private connectionPromise: Promise<void> | null = null;

  constructor(private containerHost: string, private containerPort: number = 8080) {
    this.client = new Client(
      {
        name: 'ottobot-worker',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  }

  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.establishConnection();
    return this.connectionPromise;
  }

  private async establishConnection(): Promise<void> {
    try {
      const httpUrl = `http://${this.containerHost}:${this.containerPort}/mcp`;
      logger.info(`Connecting to MCP server at ${httpUrl}`);

      this.transport = new HTTPClientTransport(httpUrl);
      await this.client.connect(this.transport);
      
      this.isConnected = true;
      logger.info('Connected to MCP server');
      
      // Load available tools
      await this.loadTools();
    } catch (error) {
      this.isConnected = false;
      this.connectionPromise = null;
      logger.error('Failed to connect to MCP server:', error);
      throw error;
    }
  }

  private async loadTools(): Promise<void> {
    try {
      const response = await this.client.listTools();
      const result = ListToolsResultSchema.parse(response);
      
      this.availableTools = result.tools || [];
      logger.info(`Loaded ${this.availableTools.length} tools:`, this.availableTools.map(t => t.name));
    } catch (error) {
      logger.error('Failed to load tools:', error);
      throw error;
    }
  }

  async getAvailableTools(): Promise<MCPTool[]> {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.availableTools;
  }

  async callTool(name: string, args: Record<string, any>): Promise<MCPToolCallResult> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      logger.info(`Calling tool: ${name}`, args);
      
      const response = await this.client.callTool({
        name,
        arguments: args
      });

      const result = CallToolResultSchema.parse(response);

      if (result.content && result.content.length > 0) {
        const content = result.content
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text)
          .join('\n');
          
        return {
          success: true,
          content
        };
      }

      return {
        success: true,
        content: 'Tool executed successfully (no output)'
      };
    } catch (error) {
      logger.error(`Tool call failed for ${name}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      // Use a simple tool call to test connectivity
      const result = await this.callTool('list_files', { path: '.' });
      return result.success;
    } catch (error) {
      logger.error('Ping failed:', error);
      return false;
    }
  }

  // Convenience methods for common tools
  async readFile(path: string): Promise<MCPToolCallResult> {
    return this.callTool('read_file', { path });
  }

  async writeFile(path: string, content: string): Promise<MCPToolCallResult> {
    return this.callTool('write_file', { path, content });
  }

  async listFiles(path: string = '.'): Promise<MCPToolCallResult> {
    return this.callTool('list_files', { path });
  }

  async executeCommand(command: string, cwd?: string): Promise<MCPToolCallResult> {
    return this.callTool('execute_command', { command, cwd });
  }

  async createDirectory(path: string): Promise<MCPToolCallResult> {
    return this.callTool('create_directory', { path });
  }

  async deleteFile(path: string): Promise<MCPToolCallResult> {
    return this.callTool('delete_file', { path });
  }

  async openVSCode(path: string): Promise<MCPToolCallResult> {
    return this.callTool('open_vscode', { path });
  }

  disconnect(): void {
    if (this.transport) {
      this.isConnected = false;
      this.transport.close();
      this.transport = null;
      this.connectionPromise = null;
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.transport !== null;
  }
}