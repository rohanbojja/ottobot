import { Worker } from 'bullmq';
import { createRedisConnection, QUEUE_NAMES } from '@/shared/queue';
import { CONFIG } from '@/shared/config';
import { createLogger } from '@/shared/logger';
import { SessionHandler } from './session-handler';
import type { WorkerJob } from '@/shared/types';

const logger = createLogger('worker');

export class AgentWorker {
  private worker: Worker<WorkerJob>;
  private sessionHandler: SessionHandler;
  private workerId: string;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.sessionHandler = new SessionHandler(workerId);
    
    this.worker = new Worker<WorkerJob>(
      QUEUE_NAMES.sessions,
      async (job) => {
        logger.info(`Processing job ${job.id} of type ${job.data.type}`);
        
        try {
          switch (job.data.type) {
            case 'create_session':
              await this.sessionHandler.createSession(job);
              break;
              
            case 'terminate_session':
              await this.sessionHandler.terminateSession(job);
              break;
              
            case 'process_message':
              await this.sessionHandler.processMessage(job);
              break;
              
            default:
              throw new Error(`Unknown job type: ${job.data.type}`);
          }
          
          logger.info(`Job ${job.id} completed successfully`);
        } catch (error) {
          logger.error(`Job ${job.id} failed:`, error);
          throw error;
        }
      },
      {
        connection: createRedisConnection(),
        concurrency: CONFIG.worker.concurrency,
        autorun: false,
        stalledInterval: 30000,
        maxStalledCount: 3,
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      logger.info(`Worker ${this.workerId} is ready`);
      this.updateWorkerStatus('active');
    });

    this.worker.on('error', (error) => {
      logger.error(`Worker ${this.workerId} error:`, error);
    });

    this.worker.on('failed', (job, error) => {
      logger.error(`Job ${job?.id} failed:`, error);
      if (job?.data.sessionId) {
        this.sessionHandler.handleJobFailure(job.data.sessionId, error);
      }
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn(`Job ${jobId} stalled`);
    });

    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  async start(): Promise<void> {
    logger.info(`Starting worker ${this.workerId}`);
    await this.worker.run();
  }

  private async shutdown(): Promise<void> {
    logger.info(`Shutting down worker ${this.workerId}`);
    await this.updateWorkerStatus('stopping');
    
    // Close worker gracefully
    await this.worker.close();
    
    // Cleanup any active sessions
    await this.sessionHandler.cleanup();
    
    await this.updateWorkerStatus('stopped');
    process.exit(0);
  }

  private async updateWorkerStatus(status: string): Promise<void> {
    const redis = createRedisConnection();
    await redis.set(`worker:${this.workerId}:status`, status);
    await redis.expire(`worker:${this.workerId}:status`, 300); // 5 minutes TTL
    await redis.quit();
  }
}

// Create and start worker if running as worker process
export async function startWorker(): Promise<void> {
  const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
  const worker = new AgentWorker(workerId);
  await worker.start();
}