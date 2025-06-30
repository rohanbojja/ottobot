import Docker from 'dockerode';
import { CONFIG } from '@/shared/config';
import { createLogger } from '@/shared/logger';
import type { ContainerConfig } from '@/shared/types';

const logger = createLogger('container-manager');

export class ContainerManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async createContainer(options: {
    sessionId: string;
    environment: string;
    vncPort: number;
  }): Promise<string> {
    const { sessionId, environment, vncPort } = options;
    
    try {
      // Build container configuration
      const config: Docker.ContainerCreateOptions = {
        name: `ottobot-${sessionId}`,
        Image: CONFIG.container.agentImage,
        Hostname: sessionId,
        Env: [
          `SESSION_ID=${sessionId}`,
          `ENVIRONMENT=${environment}`,
          `ANTHROPIC_API_KEY=${CONFIG.agent.anthropicApiKey}`,
          `VNC_PORT=${vncPort}`,
          `NOVNC_PORT=${vncPort}`,
        ],
        HostConfig: {
          Memory: this.parseMemoryLimit(CONFIG.container.memoryLimit),
          CpuShares: Math.floor(CONFIG.container.cpuLimit * 1024),
          AutoRemove: false,
          NetworkMode: CONFIG.container.network,
          PortBindings: {
            '6080/tcp': [{ HostPort: vncPort.toString() }],
          },
          Binds: [
            `/app/session-data/${sessionId}:/home/developer/workspace`,
          ],
          SecurityOpt: ['no-new-privileges'],
          ReadonlyRootfs: false,
        },
        ExposedPorts: {
          '5901/tcp': {},
          '6080/tcp': {},
        },
        WorkingDir: '/home/developer/workspace',
        User: 'developer',
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Tty: true,
      };

      const container = await this.docker.createContainer(config);
      logger.info(`Created container ${container.id} for session ${sessionId}`);
      
      return container.id;
    } catch (error) {
      logger.error(`Failed to create container for session ${sessionId}:`, error);
      throw error;
    }
  }

  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();
      logger.info(`Started container ${containerId}`);
    } catch (error) {
      logger.error(`Failed to start container ${containerId}:`, error);
      throw error;
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 }); // 10 second timeout
      logger.info(`Stopped container ${containerId}`);
    } catch (error) {
      if (error.statusCode === 304) {
        logger.info(`Container ${containerId} already stopped`);
      } else {
        logger.error(`Failed to stop container ${containerId}:`, error);
        throw error;
      }
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
      logger.info(`Removed container ${containerId}`);
    } catch (error) {
      if (error.statusCode === 404) {
        logger.info(`Container ${containerId} already removed`);
      } else {
        logger.error(`Failed to remove container ${containerId}:`, error);
        throw error;
      }
    }
  }

  async getContainerStatus(containerId: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Status;
    } catch (error) {
      logger.error(`Failed to get container status ${containerId}:`, error);
      throw error;
    }
  }

  async waitForVnc(containerId: string, vncPort: number, maxRetries: number = 30): Promise<void> {
    logger.info(`Waiting for VNC on port ${vncPort} to be ready...`);
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Check if container is running
        const status = await this.getContainerStatus(containerId);
        if (status !== 'running') {
          throw new Error(`Container is not running: ${status}`);
        }

        // Check if VNC port is accessible
        const response = await fetch(`http://localhost:${vncPort}/vnc.html`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(1000),
        });
        
        if (response.ok) {
          logger.info(`VNC on port ${vncPort} is ready`);
          return;
        }
      } catch (error) {
        // Expected to fail initially
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`VNC on port ${vncPort} did not become ready in time`);
  }

  async executeCommand(containerId: string, command: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      const container = this.docker.getContainer(containerId);
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: '/home/developer/workspace',
        User: 'developer',
      });

      const stream = await exec.start({ Detach: false });
      
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        
        stream.on('data', (chunk) => {
          // Docker multiplexes stdout/stderr
          // First byte indicates stream type
          if (chunk[0] === 1) {
            chunks.push(chunk.slice(8)); // stdout
          } else if (chunk[0] === 2) {
            errChunks.push(chunk.slice(8)); // stderr
          }
        });
        
        stream.on('end', () => {
          resolve({
            stdout: Buffer.concat(chunks).toString(),
            stderr: Buffer.concat(errChunks).toString(),
          });
        });
        
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to execute command in container ${containerId}:`, error);
      throw error;
    }
  }

  async getContainerLogs(containerId: string, tail: number = 100): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });
      
      return stream.toString();
    } catch (error) {
      logger.error(`Failed to get container logs ${containerId}:`, error);
      throw error;
    }
  }

  private parseMemoryLimit(limit: string): number {
    const units = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
    };
    
    const match = limit.toLowerCase().match(/^(\d+)([bkmg])$/);
    if (!match) {
      throw new Error(`Invalid memory limit: ${limit}`);
    }
    
    const [, value, unit] = match;
    return parseInt(value, 10) * units[unit as keyof typeof units];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      logger.error('Docker health check failed:', error);
      return false;
    }
  }

  async listSessionContainers(): Promise<Docker.ContainerInfo[]> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['managed-by=ottobot'],
        },
      });
      
      return containers;
    } catch (error) {
      logger.error('Failed to list containers:', error);
      throw error;
    }
  }

  async cleanupStaleContainers(): Promise<void> {
    try {
      const containers = await this.listSessionContainers();
      const now = Date.now();
      
      for (const containerInfo of containers) {
        const created = containerInfo.Created * 1000;
        const age = now - created;
        
        // Remove containers older than 2 hours
        if (age > 2 * 60 * 60 * 1000) {
          logger.info(`Removing stale container ${containerInfo.Id}`);
          await this.removeContainer(containerInfo.Id);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup stale containers:', error);
    }
  }
}