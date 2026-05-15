import type { SessionStorePort } from "@/application/ports";
import { SessionManager } from "@/shared/session-manager";
import type { ChatMessage, Session, SessionStatus } from "@/shared/types";

export class SqliteSessionStore implements SessionStorePort {
  getSession(sessionId: string): Promise<Session | null> {
    return SessionManager.getSession(sessionId);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    await SessionManager.updateSession(sessionId, updates);
  }

  updateSessionStatus(sessionId: string, status: SessionStatus, error?: string): Promise<void> {
    return SessionManager.updateSessionStatus(sessionId, status, error);
  }

  addSessionLog(
    sessionId: string,
    level: "info" | "warn" | "error" | "debug",
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return SessionManager.addSessionLog(sessionId, level, message, metadata);
  }

  addSessionMessage(sessionId: string, message: ChatMessage): Promise<void> {
    return SessionManager.addSessionMessage(sessionId, message);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await SessionManager.deleteSession(sessionId);
  }

  allocateVncPort(): Promise<number | null> {
    return SessionManager.allocateVncPort();
  }

  releaseVncPort(port: number): Promise<void> {
    return SessionManager.releaseVncPort(port);
  }

  allocateMcpPort(): Promise<number | null> {
    return SessionManager.allocateMcpPort();
  }

  releaseMcpPort(port: number): Promise<void> {
    return SessionManager.releaseMcpPort(port);
  }
}
