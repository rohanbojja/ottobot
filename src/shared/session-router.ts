import { createLogger } from './logger';
import type { ChatMessage } from './types';

const logger = createLogger('session-router');

export class SessionRouter {
  private static subscribers = new Map<string, Set<(message: ChatMessage) => void>>();

  // Subscribe to session messages
  static subscribe(sessionId: string, callback: (message: ChatMessage) => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    
    this.subscribers.get(sessionId)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
    };
  }

  // Publish message to session subscribers
  static async publish(sessionId: string, message: ChatMessage): Promise<void> {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.forEach((callback) => {
        try {
          callback(message);
        } catch (error) {
          logger.error(`Error in subscriber callback for session ${sessionId}:`, error);
        }
      });
    }
  }

  // Initialize the message handler
  static initialize(): void {
    logger.info('SessionRouter initialized in local mode');
  }
}

// Initialize on import
SessionRouter.initialize();
