import { Job } from 'bullmq';
import { SessionManager } from '@/shared/session-manager';
import { createLogger } from '@/shared/logger';
import { ContainerManager } from './container-manager';
import { SessionRouter } from '@/shared/session-router';
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

    let mcpPort: number | null = null;

    try {
      // Update session with worker assignment
      await SessionManager.updateSession(sessionId, { workerId: this.workerId });
      
      // Log progress
      await job.updateProgress(10);
      await SessionManager.addSessionLog(sessionId, 'info', 'Allocating MCP port...');

      // Allocate MCP port
      mcpPort = await SessionManager.allocateMcpPort();
      if (!mcpPort) {
        throw new Error('No available MCP ports');
      }

      await SessionManager.addSessionLog(sessionId, 'info', `Allocated MCP port ${mcpPort}, creating container...`);

      // Create container
      const containerId = await this.containerManager.createContainer({
        sessionId,
        environment,
        vncPort,
        mcpPort,
      });

      await job.updateProgress(30);
      await SessionManager.updateSession(sessionId, { containerId, mcpPort });
      await SessionManager.addSessionLog(sessionId, 'info', 'Starting container...');

      // Start container
      await this.containerManager.startContainer(containerId);
      
      await job.updateProgress(50);
      await SessionManager.addSessionLog(sessionId, 'info', 'Waiting for VNC to be ready...');

      // Wait for VNC to be ready
      await this.containerManager.waitForVnc(containerId, vncPort);
      
      await job.updateProgress(70);
      await SessionManager.addSessionLog(sessionId, 'info', 'Starting AI agent...');

      // Start agent with the pre-allocated MCP port
      await this.startAgent(sessionId, containerId, initialPrompt, mcpPort);
      
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      await SessionManager.updateSessionStatus(sessionId, 'error', errorMessage);
      
      // Cleanup on failure
      try {
        // Get current session state for cleanup
        const session = await SessionManager.getSession(sessionId);
        
        // Remove container if it was created
        if (session?.containerId) {
          try {
            await this.containerManager.stopContainer(session.containerId);
            await this.containerManager.removeContainer(session.containerId);
          } catch (containerError) {
            logger.warn(`Container cleanup failed during error handling:`, containerError);
          }
        }
        
        // Release VNC port
        if (vncPort) {
          await SessionManager.releaseVncPort(vncPort);
        }

        // Release MCP port
        if (mcpPort) {
          await SessionManager.releaseMcpPort(mcpPort);
        }
        
        // Remove session entirely
        await SessionManager.deleteSession(sessionId);
      } catch (cleanupError) {
        logger.error(`Cleanup failed for session ${sessionId}:`, cleanupError);
      }
      
      throw error;
    }
  }

  async terminateSession(job: Job<WorkerJob>): Promise<void> {
    const { sessionId, data } = job.data;
    const { containerId, vncPort, mcpPort } = data;

    try {
      await SessionManager.addSessionLog(sessionId, 'info', 'Terminating session...');
      
      // Stop agent
      const agent = this.activeAgents.get(sessionId);
      if (agent) {
        await agent.shutdown();
        this.activeAgents.delete(sessionId);
      }

      await job.updateProgress(30);

      // Stop and remove container with retry logic
      if (containerId) {
        try {
          await this.containerManager.stopContainer(containerId);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for graceful shutdown
          await this.containerManager.removeContainer(containerId);
        } catch (error) {
          logger.warn(`Container cleanup failed for ${containerId}, attempting force removal:`, error);
          try {
            // Force remove as fallback
            await this.containerManager.removeContainer(containerId);
          } catch (forceError) {
            logger.error(`Force container removal failed:`, forceError);
            // Continue with session cleanup even if container removal fails
          }
        }
      }

      await job.updateProgress(70);

      // Release VNC port
      if (vncPort) {
        await SessionManager.releaseVncPort(vncPort);
      }

      // Release MCP port
      if (mcpPort) {
        await SessionManager.releaseMcpPort(mcpPort);
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
        // TODO: Start agent if not running, will be handled once agent runtime is moved out of worker
        // For now, throw error
        // API -> Worker (back pressure) -> Agent (runtime which interfaces with MCP server in the sandbox container). Agent runs inside worker for now
        throw new Error('Agent not running');
      }

      // First, publish the user's message
      await SessionRouter.publish(sessionId, {
        type: 'user_prompt',
        content: message.content,
        timestamp: Date.now(),
      });

      // Process message with agent
      await agent.processMessage(message.content);

      logger.info(`Processed message for session ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to process message for session ${sessionId}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      await SessionRouter.publish(sessionId, {
        type: 'error',
        content: `Failed to process message: ${errorMessage}`,
        timestamp: Date.now(),
      });
      
      throw error;
    }
  }

  private async startAgent(sessionId: string, containerId: string, initialPrompt: string, mcpPort: number): Promise<void> {
    logger.info(`Starting agent for session ${sessionId} (container: ${containerId}) with MCP port ${mcpPort} and prompt: ${initialPrompt}`);
    
    const onMessage = async (message: ChatMessage) => {
      await SessionRouter.publish(sessionId, message);
      await SessionManager.addSessionMessage(sessionId, message);
    };

    // Create and initialize agent with MCP client configured for localhost and allocated port
    const agent = new CodingAgent(sessionId, onMessage, 'localhost', mcpPort);
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