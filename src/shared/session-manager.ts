import { nanoid } from "nanoid";
import type { Session, SessionStatus } from "./types";
import { redis } from "@/api/plugins/redis";
import { createLogger } from "./logger";
import { CONFIG } from "./config";

const logger = createLogger("session-manager");

const SESSION_PREFIX = "session:";
const SESSION_INDEX = "sessions:index";
const SESSION_BY_WORKER = "sessions:by-worker:";

export class SessionManager {
  // Create a new session
  static async createSession(
    initialPrompt: string,
    timeout?: number,
  ): Promise<Session> {
    const sessionId = nanoid();
    const now = new Date();
    const timeoutMs = (timeout || CONFIG.session.timeout / 1000) * 1000;

    const session: Session = {
      id: sessionId,
      status: "initializing",
      initialPrompt,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
    };

    // Store session in Redis
    await redis.setex(
      `${SESSION_PREFIX}${sessionId}`,
      timeoutMs / 1000, // TTL in seconds
      JSON.stringify(session),
    );

    // Add to session index
    await redis.sadd(SESSION_INDEX, sessionId);

    logger.info(`Created session ${sessionId}`);
    return session;
  }

  // Get session by ID
  static async getSession(sessionId: string): Promise<Session | null> {
    const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  // Update session
  static async updateSession(
    sessionId: string,
    updates: Partial<Session>,
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const updatedSession: Session = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };

    // Calculate remaining TTL
    const ttl = await redis.ttl(`${SESSION_PREFIX}${sessionId}`);
    if (ttl > 0) {
      await redis.setex(
        `${SESSION_PREFIX}${sessionId}`,
        ttl,
        JSON.stringify(updatedSession),
      );
    }

    // Update worker assignment if provided
    if (updates.workerId && updates.workerId !== session.workerId) {
      if (session.workerId) {
        await redis.srem(`${SESSION_BY_WORKER}${session.workerId}`, sessionId);
      }
      await redis.sadd(`${SESSION_BY_WORKER}${updates.workerId}`, sessionId);
    }

    logger.info(`Updated session ${sessionId}`, { updates });
    return updatedSession;
  }

  // Update session status
  static async updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    error?: string,
  ): Promise<void> {
    const updates: Partial<Session> = { status };
    if (error) updates.error = error;

    await this.updateSession(sessionId, updates);
  }

  // Delete session
  static async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    // Remove from Redis
    await redis.del(`${SESSION_PREFIX}${sessionId}`);
    await redis.srem(SESSION_INDEX, sessionId);

    // Remove from worker assignment
    if (session.workerId) {
      await redis.srem(`${SESSION_BY_WORKER}${session.workerId}`, sessionId);
    }

    // Remove related data
    await redis.del(`session:messages:${sessionId}`);
    await redis.del(`session:logs:${sessionId}`);
    await redis.del(`session:context:${sessionId}`);

    logger.info(`Deleted session ${sessionId}`);
    return true;
  }

  // Get all active sessions
  static async getActiveSessions(): Promise<Session[]> {
    const sessionIds = await redis.smembers(SESSION_INDEX);
    const sessions: Session[] = [];

    for (const id of sessionIds) {
      const session = await this.getSession(id);
      if (session && session.status !== "terminated") {
        sessions.push(session);
      }
    }

    return sessions;
  }

  // Get sessions by worker
  static async getSessionsByWorker(workerId: string): Promise<string[]> {
    return redis.smembers(`${SESSION_BY_WORKER}${workerId}`);
  }

  // Store session message
  static async addSessionMessage(
    sessionId: string,
    message: any,
  ): Promise<void> {
    const key = `session:messages:${sessionId}`;
    await redis.rpush(key, JSON.stringify(message));

    // Set expiry to match session TTL
    const ttl = await redis.ttl(`${SESSION_PREFIX}${sessionId}`);
    if (ttl > 0) {
      await redis.expire(key, ttl);
    }
  }

  // Get session messages
  static async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<any[]> {
    const key = `session:messages:${sessionId}`;
    const messages = limit
      ? await redis.lrange(key, -limit, -1)
      : await redis.lrange(key, 0, -1);

    return messages.map((msg) => JSON.parse(msg));
  }

  // Add session log
  static async addSessionLog(
    sessionId: string,
    level: string,
    message: string,
    metadata?: any,
  ): Promise<void> {
    const log = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };

    const key = `session:logs:${sessionId}`;
    await redis.rpush(key, JSON.stringify(log));

    // Keep only last 1000 logs
    await redis.ltrim(key, -1000, -1);

    // Set expiry to match session TTL
    const ttl = await redis.ttl(`${SESSION_PREFIX}${sessionId}`);
    if (ttl > 0) {
      await redis.expire(key, ttl);
    }
  }

  // Get session logs
  static async getSessionLogs(
    sessionId: string,
    limit: number = 100,
  ): Promise<any[]> {
    const key = `session:logs:${sessionId}`;
    const logs = await redis.lrange(key, -limit, -1);
    return logs.map((log) => JSON.parse(log));
  }

  // Allocate VNC port
  static async allocateVncPort(): Promise<number | null> {
    const start = CONFIG.container.vncPortRangeStart;
    const end = CONFIG.container.vncPortRangeEnd;

    for (let port = start; port <= end; port++) {
      const allocated = await redis.setnx(`vnc:port:${port}`, "1");
      if (allocated) {
        // Set expiry to prevent leaks
        await redis.expire(`vnc:port:${port}`, 7200); // 2 hours
        return port;
      }
    }

    logger.error("No available VNC ports");
    return null;
  }

  // Release VNC port
  static async releaseVncPort(port: number): Promise<void> {
    await redis.del(`vnc:port:${port}`);
  }

  // Allocate MCP port
  static async allocateMcpPort(): Promise<number | null> {
    const start = CONFIG.container.mcpPortRangeStart;
    const end = CONFIG.container.mcpPortRangeEnd;

    for (let port = start; port <= end; port++) {
      const allocated = await redis.setnx(`mcp:port:${port}`, "1");
      if (allocated) {
        // Set expiry to prevent leaks
        await redis.expire(`mcp:port:${port}`, 7200); // 2 hours
        return port;
      }
    }

    logger.error("No available MCP ports");
    return null;
  }

  // Release MCP port
  static async releaseMcpPort(port: number): Promise<void> {
    await redis.del(`mcp:port:${port}`);
  }

  // Session context management
  static async getSessionContext(sessionId: string): Promise<string | null> {
    return redis.get(`session:context:${sessionId}`);
  }

  static async storeSessionContext(
    sessionId: string,
    context: string,
  ): Promise<void> {
    const key = `session:context:${sessionId}`;
    const ttl = await redis.ttl(`${SESSION_PREFIX}${sessionId}`);

    if (ttl > 0) {
      await redis.setex(key, ttl, context);
    } else {
      await redis.set(key, context);
    }
  }

  static async clearSessionContext(sessionId: string): Promise<void> {
    await redis.del(`session:context:${sessionId}`);
  }
}
