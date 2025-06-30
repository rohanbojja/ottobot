import { createLogger } from './logger';
import type { ChatMessage } from './types';
import IORedis from 'ioredis';
import { CONFIG } from './config';

const logger = createLogger('session-router');

// Create a Redis instance for pub/sub
const pubClient = new IORedis({
  host: CONFIG.redis.host,
  port: CONFIG.redis.port,
  password: CONFIG.redis.password,
});

const subClient = pubClient.duplicate();

export class SessionRouter {
  private static subscribers = new Map<string, Set<(message: ChatMessage) => void>>();
  private static redisSubscriptions = new Map<string, boolean>();

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
    try {
      // Publish to Redis for cross-process communication
      await pubClient.publish(`session:${sessionId}:messages`, JSON.stringify(message));
      
      // Also notify local subscribers directly
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
    } catch (error) {
      logger.error(`Failed to publish message for session ${sessionId}:`, error);
      throw error;
    }
  }

  // Start listening to Redis pubsub for a session
  private static startListening(sessionId: string): void {
    const channel = `session:${sessionId}:messages`;
    
    if (!this.redisSubscriptions.has(channel)) {
      this.redisSubscriptions.set(channel, true);
      
      subClient.subscribe(channel, (err) => {
        if (err) {
          logger.error(`Failed to subscribe to ${channel}:`, err);
          this.redisSubscriptions.delete(channel);
        } else {
          logger.info(`Subscribed to ${channel}`);
        }
      });
    }
  }

  // Stop listening to Redis pubsub for a session
  private static stopListening(sessionId: string): void {
    const channel = `session:${sessionId}:messages`;
    
    if (this.redisSubscriptions.has(channel)) {
      subClient.unsubscribe(channel, (err) => {
        if (err) {
          logger.error(`Failed to unsubscribe from ${channel}:`, err);
        } else {
          logger.info(`Unsubscribed from ${channel}`);
        }
      });
      this.redisSubscriptions.delete(channel);
    }
  }

  // Initialize the message handler
  static initialize(): void {
    subClient.on('message', (channel, message) => {
      try {
        // Extract sessionId from channel name
        const match = channel.match(/^session:(.+):messages$/);
        if (!match) {
          logger.warn(`Received message on unknown channel: ${channel}`);
          return;
        }
        
        const sessionId = match[1];
        const parsedMessage = JSON.parse(message) as ChatMessage;
        
        // Notify local subscribers
        const subs = this.subscribers.get(sessionId);
        if (subs) {
          subs.forEach(callback => {
            try {
              callback(parsedMessage);
            } catch (error) {
              logger.error(`Error in subscriber callback for session ${sessionId}:`, error);
            }
          });
        }
      } catch (error) {
        logger.error(`Error processing message from ${channel}:`, error);
      }
    });
    
    logger.info('SessionRouter initialized');
  }
}

// Initialize on import
SessionRouter.initialize();