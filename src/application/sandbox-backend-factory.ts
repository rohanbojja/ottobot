import { CONFIG } from "@/shared/config";
import type { SandboxBackend } from "@/application/ports";
import { DockerSessionBackend } from "@/application/adapters/docker-session-backend";

export function createSandboxBackend(): SandboxBackend {
  switch (CONFIG.container.backend) {
    case "docker":
      return new DockerSessionBackend();
    case "daytona":
    case "e2b":
    case "firecracker":
      throw new Error(`Sandbox backend "${CONFIG.container.backend}" is not implemented yet`);
    default:
      throw new Error(`Unsupported sandbox backend: ${CONFIG.container.backend}`);
  }
}
