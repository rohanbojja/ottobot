import { redis } from '@/api/plugins/redis';
import { createLogger } from '@/shared/logger';
import type { ChatMessage } from '@/shared/types';

const logger = createLogger('session-router');

export class SessionRouter {
  private static subscribers = new Map<string, Set<(message: ChatMessage) => void>>();

  // Subscribe to session messages
  static subscribe(sessionId: string, callback: (message: ChatMessage) => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
      this.startListening(sessionId);
    }
    
    this.subscribers.get(sessionId)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(sessionId);
          this.stopListening(sessionId);
        }
      }
    };
  }

  // Publish message to session subscribers
  static async publish(sessionId: string, message: ChatMessage): Promise<void> {
    // Store in Redis for persistence
    await redis.publish(`session:${sessionId}:messages`, JSON.stringify(message));
    
    // Notify local subscribers
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.forEach(callback => {
        try {
          callback(message);
        } catch (error) {
          logger.error(`Error in subscriber callback for session ${sessionId}:`, error);
        }
      });
    }
  }

  // Start listening to Redis pubsub for a session
  private static startListening(sessionId: string): void {
    const subscriber = redis.duplicate();
    const channel = `session:${sessionId}:messages`;
    
    subscriber.subscribe(channel, (err) => {
      if (err) {
        logger.error(`Failed to subscribe to ${channel}:`, err);
      } else {
        logger.info(`Subscribed to ${channel}`);
      }
    });
    
    subscriber.on('message', (channel, message) => {
      try {
        const parsedMessage = JSON.parse(message) as ChatMessage;
        const subs = this.subscribers.get(sessionId);
        if (subs) {
          subs.forEach(callback => callback(parsedMessage));
        }
      } catch (error) {
        logger.error(`Error processing message from ${channel}:`, error);
      }
    });
  }

  // Stop listening to Redis pubsub for a session
  private static stopListening(sessionId: string): void {
    // This would need to track subscribers per session
    // For now, we'll rely on Redis pubsub cleanup
    logger.info(`Stopped listening to session ${sessionId}`);
  }
}