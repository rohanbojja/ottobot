import { BaseMessage } from '@langchain/core/messages';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { CONFIG } from '@/shared/config';

const logger = createLogger('context-manager');

interface Context {
  recentMessages: BaseMessage[];
  summary?: string;
  tokenCount: number;
  projectInfo?: {
    files: string[];
    structure: any;
    dependencies?: any;
  };
}

export class ContextManager {
  private sessionId: string;
  private maxTokens: number;
  private maxRecentMessages: number;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.maxTokens = CONFIG.agent.contextWindowSize;
    this.maxRecentMessages = 50;
  }

  async updateContext(messages: BaseMessage[]): Promise<Context> {
    // Get stored context
    const storedContext = await this.getStoredContext();
    
    // Calculate token count (simplified - use tiktoken in production)
    const tokenCount = this.estimateTokenCount(messages);
    
    // Prune messages if needed
    let recentMessages = messages.slice(-this.maxRecentMessages);
    
    if (tokenCount > this.maxTokens * 0.8) {
      // Need to compress context
      logger.info(`Context compression needed for session ${this.sessionId}`);
      recentMessages = await this.compressMessages(messages);
    }

    const context: Context = {
      recentMessages,
      tokenCount,
      summary: storedContext?.summary,
      projectInfo: storedContext?.projectInfo,
    };

    // Store updated context
    await this.storeContext(context);
    
    return context;
  }

  async getStoredContext(): Promise<Context | null> {
    try {
      const stored = await SessionManager.getSessionContext(this.sessionId);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      logger.error('Failed to get stored context:', error);
      return null;
    }
  }

  async storeContext(context: Context): Promise<void> {
    try {
      await SessionManager.storeSessionContext(
        this.sessionId,
        JSON.stringify(context)
      );
    } catch (error) {
      logger.error('Failed to store context:', error);
    }
  }

  private async compressMessages(messages: BaseMessage[]): Promise<BaseMessage[]> {
    // Keep first few and last many messages
    const keepFirst = 5;
    const keepLast = 30;
    
    if (messages.length <= keepFirst + keepLast) {
      return messages;
    }

    const firstMessages = messages.slice(0, keepFirst);
    const lastMessages = messages.slice(-keepLast);
    const middleMessages = messages.slice(keepFirst, -keepLast);

    // In production, summarize middle messages using LLM
    const summary = `[${middleMessages.length} messages summarized]`;
    
    logger.info(`Compressed ${middleMessages.length} messages for session ${this.sessionId}`);
    
    return [
      ...firstMessages,
      new BaseMessage({ content: summary, type: 'system' }),
      ...lastMessages,
    ];
  }

  private estimateTokenCount(messages: BaseMessage[]): number {
    // Simplified token estimation - ~4 chars per token
    const totalChars = messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + content.length;
    }, 0);
    
    return Math.ceil(totalChars / 4);
  }

  async addProjectInfo(info: Context['projectInfo']): Promise<void> {
    const context = await this.getStoredContext() || {
      recentMessages: [],
      tokenCount: 0,
    };
    
    context.projectInfo = info;
    await this.storeContext(context);
  }

  async clear(): Promise<void> {
    await SessionManager.clearSessionContext(this.sessionId);
    logger.info(`Cleared context for session ${this.sessionId}`);
  }
}