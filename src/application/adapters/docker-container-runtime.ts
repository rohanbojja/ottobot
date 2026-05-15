import { DockerSandboxBackend } from "@/application/adapters/docker-sandbox-backend";

/**
 * Compatibility alias while the persisted session field is still named
 * `containerId`. New orchestration code should depend on DockerSandboxBackend.
 */
export class DockerContainerRuntime extends DockerSandboxBackend {}
