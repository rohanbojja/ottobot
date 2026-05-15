import type { WorkspaceManager, WorkspaceSession } from "@/application/ports";

export class ScratchWorkspaceManager implements WorkspaceManager {
  createWorkspace(input: { sessionId: string }): Promise<WorkspaceSession> {
    return Promise.resolve({
      sessionId: input.sessionId,
      mode: "scratch",
      hostPath: `/tmp/ottobot-session-data/${input.sessionId}`,
      sandboxPath: "/home/developer/workspace",
    });
  }
}

