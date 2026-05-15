import { existsSync } from "node:fs";
import { join } from "node:path";
import Docker from "dockerode";

function unixSocketFromDockerHost(value: string | undefined): string | null {
  if (!value?.startsWith("unix://")) return null;
  return value.slice("unix://".length);
}

function dockerSocketCandidates(): string[] {
  const candidates: string[] = [];
  const dockerHostSocket = unixSocketFromDockerHost(process.env["DOCKER_HOST"]);
  const explicitSocket = process.env["DOCKER_SOCKET_PATH"];

  if (dockerHostSocket) candidates.push(dockerHostSocket);
  if (explicitSocket) candidates.push(explicitSocket);

  candidates.push("/var/run/docker.sock");

  const home = process.env["HOME"];
  if (home) {
    candidates.push(join(home, ".orbstack/run/docker.sock"));
    candidates.push(join(home, ".docker/run/docker.sock"));
  }

  return [...new Set(candidates)];
}

export function resolveDockerSocketPath(): string | null {
  return dockerSocketCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

export function createDockerClient(): Docker {
  const socketPath = resolveDockerSocketPath();
  return socketPath ? new Docker({ socketPath }) : new Docker();
}
