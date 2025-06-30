import { Job } from 'bullmq';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { ContainerManager } from './container-manager';
import { SessionRouter } from '@/api/websocket/session-router';
import { CodingAgent } from '@/agent/coding-agent';
import type { WorkerJob, ChatMessage } from '@/shared/types';

const logger = createLogger('session-handler');

export class SessionHandler {
  private containerManager: ContainerManager;
  private activeAgents = new Map<string, CodingAgent>();
  private workerId: string;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.containerManager = new ContainerManager();
  }

  async createSession(job: Job<WorkerJob>): Promise<void> {
    const { sessionId, data } = job.data;
    const { initialPrompt, environment, vncPort } = data;

    try {
      // Update session with worker assignment
      await SessionManager.updateSession(sessionId, { workerId: this.workerId });
      
      // Log progress
      await job.updateProgress(10);
      await SessionManager.addSessionLog(sessionId, 'info', 'Creating container...');

      // Create container
      const containerId = await this.containerManager.createContainer({
        sessionId,
        environment,
        vncPort,
      });

      await job.updateProgress(30);
      await SessionManager.updateSession(sessionId, { containerId });
      await SessionManager.addSessionLog(sessionId, 'info', 'Starting container...');

      // Start container
      await this.containerManager.startContainer(containerId);
      
      await job.updateProgress(50);
      await SessionManager.addSessionLog(sessionId, 'info', 'Waiting for VNC to be ready...');

      // Wait for VNC to be ready
      await this.containerManager.waitForVnc(containerId, vncPort);
      
      await job.updateProgress(70);
      await SessionManager.addSessionLog(sessionId, 'info', 'Starting AI agent...');

      // Start agent
      await this.startAgent(sessionId, containerId, initialPrompt);
      
      await job.updateProgress(90);
      
      // Update session status
      await SessionManager.updateSessionStatus(sessionId, 'ready');
      await SessionManager.addSessionLog(sessionId, 'info', 'Session ready');

      // Send ready message
      await SessionRouter.publish(sessionId, {
        type: 'system_update',
        content: 'Session is ready. You can start chatting!',
        timestamp: Date.now(),
        metadata: {
          vnc_ready: true,
        },
      });

      await job.updateProgress(100);
      logger.info(`Session ${sessionId} created successfully`);
    } catch (error) {
      logger.error(`Failed to create session ${sessionId}:`, error);
      await SessionManager.updateSessionStatus(sessionId, 'error', error.message);
      
      // Cleanup on failure
      if (vncPort) {
        await SessionManager.releaseVncPort(vncPort);
      }
      
      throw error;
    }
  }

  async terminateSession(job: Job<WorkerJob>): Promise<void> {
    const { sessionId, data } = job.data;
    const { containerId, vncPort } = data;

    try {
      await SessionManager.addSessionLog(sessionId, 'info', 'Terminating session...');
      
      // Stop agent
      const agent = this.activeAgents.get(sessionId);
      if (agent) {
        await agent.shutdown();
        this.activeAgents.delete(sessionId);
      }

      await job.updateProgress(30);

      // Stop and remove container
      if (containerId) {
        await this.containerManager.stopContainer(containerId);
        await this.containerManager.removeContainer(containerId);
      }

      await job.updateProgress(70);

      // Release VNC port
      if (vncPort) {
        await SessionManager.releaseVncPort(vncPort);
      }

      // Update session status
      await SessionManager.updateSessionStatus(sessionId, 'terminated');
      
      await job.updateProgress(90);

      // Clean up session data after a delay
      setTimeout(async () => {
        await SessionManager.deleteSession(sessionId);
      }, 300000); // 5 minutes

      await job.updateProgress(100);
      logger.info(`Session ${sessionId} terminated successfully`);
    } catch (error) {
      logger.error(`Failed to terminate session ${sessionId}:`, error);
      throw error;
    }
  }

  async processMessage(job: Job<WorkerJob>): Promise<void> {
    const { sessionId, data } = job.data;
    const { message } = data;

    try {
      // Get session
      const session = await SessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Get agent
      const agent = this.activeAgents.get(sessionId);
      if (!agent) {
        throw new Error('Agent not running');
      }

      // Process message with agent
      await agent.processMessage(message.content);

      logger.info(`Processed message for session ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to process message for session ${sessionId}:`, error);
      
      await SessionRouter.publish(sessionId, {
        type: 'error',
        content: `Failed to process message: ${error.message}`,
        timestamp: Date.now(),
      });
      
      throw error;
    }
  }

  private async startAgent(sessionId: string, containerId: string, initialPrompt: string): Promise<void> {
    logger.info(`Starting agent for session ${sessionId} with prompt: ${initialPrompt}`);
    
    // Create message handler
    const onMessage = async (message: ChatMessage) => {
      await SessionRouter.publish(sessionId, message);
      await SessionManager.addSessionMessage(sessionId, message);
    };

    // Create and initialize agent
    const agent = new CodingAgent(sessionId, onMessage);
    this.activeAgents.set(sessionId, agent);

    // Initialize with initial prompt
    await agent.initialize(initialPrompt);
  }

  async handleJobFailure(sessionId: string, error: Error): Promise<void> {
    await SessionManager.updateSessionStatus(sessionId, 'error', error.message);
    await SessionManager.addSessionLog(sessionId, 'error', `Job failed: ${error.message}`);
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up active sessions...');
    
    // Shutdown all active agents
    for (const [sessionId, agent] of this.activeAgents) {
      try {
        await agent.shutdown();
        await SessionManager.updateSessionStatus(sessionId, 'terminated');
      } catch (error) {
        logger.error(`Failed to cleanup session ${sessionId}:`, error);
      }
    }
    
    this.activeAgents.clear();
  }
}