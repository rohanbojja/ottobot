import type { SandboxBackend, SandboxInstance, WorkspaceSession } from "@/application/ports";
import { DockerContainerManager } from "@/application/adapters/docker-container-manager";

export class DockerSessionBackend extends DockerContainerManager implements SandboxBackend {
  readonly backend = "docker";

  async createSandbox(input: {
    sessionId: string;
    environment: string;
    vncPort: number;
    mcpPort: number;
    workspace: WorkspaceSession;
  }): Promise<SandboxInstance> {
    const id = await this.createContainer({
      sessionId: input.sessionId,
      environment: input.environment,
      vncPort: input.vncPort,
      mcpPort: input.mcpPort,
      workspaceHostPath: input.workspace.hostPath,
      sandboxWorkspacePath: input.workspace.sandboxPath,
    });

    return {
      id,
      backend: this.backend,
      workspace: input.workspace,
    };
  }

  startSandbox(sandboxId: string): Promise<void> {
    return this.startContainer(sandboxId);
  }

  stopSandbox(sandboxId: string): Promise<void> {
    return this.stopContainer(sandboxId);
  }

  destroySandbox(sandboxId: string): Promise<void> {
    return this.removeContainer(sandboxId);
  }

  isSandboxRunning(sandboxId: string): Promise<boolean> {
    return this.isContainerRunning(sandboxId);
  }

  waitForReady(sandboxId: string, input: { vncPort: number; mcpPort: number }): Promise<void> {
    void input.mcpPort;
    return this.waitForVnc(sandboxId, input.vncPort);
  }

  getSandboxLogs(sandboxId: string, tail?: number): Promise<string> {
    return this.getContainerLogs(sandboxId, tail);
  }
}
