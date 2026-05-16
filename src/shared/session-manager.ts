import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import type { ChatMessage, Session, SessionStatus } from "./types";
import { createLogger } from "./logger";
import { CONFIG } from "./config";
import { sanitizeUIMessages } from "./ui-messages";

const logger = createLogger("session-manager");

type SessionRow = {
  id: string;
  status: SessionStatus;
  initial_prompt: string;
  container_id: string | null;
  vnc_url: string | null;
  vnc_port: number | null;
  mcp_port: number | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  error: string | null;
  metadata: string | null;
};

type CountRow = { count: number };
type ValueRow = { value: string | number | null };
type PayloadRow = { payload: string };
type UIMessageRow = { payload: string; position: number };
type LogRow = {
  timestamp: string;
  level: string;
  message: string;
  metadata: string | null;
};

const dbPath = resolve(process.env["OTTOBOT_SQLITE_PATH"] || "session-data/ottobot.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { create: true, readwrite: true, strict: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    initial_prompt TEXT NOT NULL,
    container_id TEXT,
    vnc_url TEXT,
    vnc_port INTEGER,
    mcp_port INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    error TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_ui_messages (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, message_id),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_session_ui_messages_session_position
    ON session_ui_messages(session_id, position);

  CREATE TABLE IF NOT EXISTS session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS allocated_ports (
    kind TEXT NOT NULL,
    port INTEGER NOT NULL,
    session_id TEXT,
    allocated_at TEXT NOT NULL,
    PRIMARY KEY(kind, port)
  );

  CREATE TABLE IF NOT EXISTS metrics (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`);

function toSession(row: SessionRow): Session {
  const metadata = row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined;

  return {
    id: row.id,
    status: row.status,
    initialPrompt: row.initial_prompt,
    ...(row.container_id ? { containerId: row.container_id } : {}),
    ...(row.vnc_url ? { vncUrl: row.vnc_url } : {}),
    ...(row.vnc_port !== null ? { vncPort: row.vnc_port } : {}),
    ...(row.mcp_port !== null ? { mcpPort: row.mcp_port } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: new Date(row.expires_at),
    ...(row.error ? { error: row.error } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function sessionToBindings(session: Session) {
  return {
    id: session.id,
    status: session.status,
    initialPrompt: session.initialPrompt,
    containerId: session.containerId ?? null,
    vncUrl: session.vncUrl ?? null,
    vncPort: session.vncPort ?? null,
    mcpPort: session.mcpPort ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    error: session.error ?? null,
    metadata: session.metadata ? JSON.stringify(session.metadata) : null,
  };
}

function parseJsonPayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

function legacyMessageToUIMessage(message: ChatMessage, index: number): UIMessage | null {
  if (message.type !== "user_prompt" && message.type !== "agent_response" && message.type !== "error") {
    return null;
  }

  const role = message.type === "user_prompt" ? "user" : "assistant";
  const text = message.content || message.metadata?.error || "";
  if (!text) return null;

  return {
    id: `legacy-${index}-${message.timestamp}-${message.type}`,
    role,
    parts: [{ type: "text", text }],
    metadata: {
      legacyType: message.type,
      timestamp: message.timestamp,
      ...message.metadata,
    },
  };
}

export class SessionManager {
  static get dbPath(): string {
    return dbPath;
  }

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

    const values = sessionToBindings(session);
    db.query(`
      INSERT INTO sessions (
        id, status, initial_prompt, container_id, vnc_url, vnc_port, mcp_port,
        created_at, updated_at, expires_at, error, metadata
      )
      VALUES (
        $id, $status, $initialPrompt, $containerId, $vncUrl, $vncPort, $mcpPort,
        $createdAt, $updatedAt, $expiresAt, $error, $metadata
      )
    `).run(values);

    db.query(`
      INSERT INTO metrics (key, value) VALUES ('total_sessions', 1)
      ON CONFLICT(key) DO UPDATE SET value = value + 1
    `).run();

    logger.info(`Created session ${sessionId}`);
    return session;
  }

  static async getSession(sessionId: string): Promise<Session | null> {
    const row = db.query<SessionRow, [string]>(
      "SELECT * FROM sessions WHERE id = ?",
    ).get(sessionId);

    return row ? toSession(row) : null;
  }

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

    const values = sessionToBindings(updatedSession);
    db.query(`
      UPDATE sessions SET
        status = $status,
        initial_prompt = $initialPrompt,
        container_id = $containerId,
        vnc_url = $vncUrl,
        vnc_port = $vncPort,
        mcp_port = $mcpPort,
        created_at = $createdAt,
        updated_at = $updatedAt,
        expires_at = $expiresAt,
        error = $error,
        metadata = $metadata
      WHERE id = $id
    `).run(values);

    logger.info(`Updated session ${sessionId}`, { updates });
    return updatedSession;
  }

  static async updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    error?: string,
  ): Promise<void> {
    const updates: Partial<Session> = { status };
    if (error) updates.error = error;

    await this.updateSession(sessionId, updates);
  }

  static async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    db.query("DELETE FROM allocated_ports WHERE session_id = ?").run(sessionId);
    db.query("DELETE FROM sessions WHERE id = ?").run(sessionId);

    logger.info(`Deleted session ${sessionId}`);
    return true;
  }

  static async getActiveSessions(): Promise<Session[]> {
    const rows = db.query<SessionRow, []>(`
      SELECT * FROM sessions
      WHERE status != 'terminated'
      ORDER BY created_at DESC
    `).all();

    return rows.map(toSession);
  }

  static async getTotalSessionsCount(): Promise<number> {
    const row = db.query<ValueRow, []>(
      "SELECT value FROM metrics WHERE key = 'total_sessions'",
    ).get();

    return typeof row?.value === "number" ? row.value : 0;
  }

  private static async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<ChatMessage[]> {
    const rows = db.query<PayloadRow, [string, number]>(`
      SELECT payload FROM session_messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit ?? 1000);

    return rows.reverse().map((row) => parseJsonPayload<ChatMessage>(row.payload));
  }

  static async upsertSessionUIMessages(
    sessionId: string,
    messages: UIMessage[],
  ): Promise<void> {
    const now = new Date().toISOString();
    const validMessages = sanitizeUIMessages(messages);
    const saveMessages = db.transaction((items: UIMessage[]) => {
      items.forEach((message, position) => {
        db.query(`
          INSERT INTO session_ui_messages (
            session_id, message_id, position, payload, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, message_id) DO UPDATE SET
            position = excluded.position,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `).run(
          sessionId,
          message.id,
          position,
          JSON.stringify(message),
          now,
          now,
        );
      });
    });

    saveMessages(validMessages);
  }

  static async getSessionUIMessages(sessionId: string): Promise<UIMessage[]> {
    const rows = db.query<UIMessageRow, [string]>(`
      SELECT payload, position FROM session_ui_messages
      WHERE session_id = ?
      ORDER BY position ASC, created_at ASC
    `).all(sessionId);

    if (rows.length > 0) {
      return sanitizeUIMessages(rows.map((row) => parseJsonPayload<UIMessage>(row.payload)));
    }

    const legacyMessages = await this.getSessionMessages(sessionId);
    const uiMessages = legacyMessages
      .map(legacyMessageToUIMessage)
      .filter((message): message is UIMessage => message !== null);
    return sanitizeUIMessages(uiMessages);
  }

  static async addSessionLog(
    sessionId: string,
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    db.query(`
      INSERT INTO session_logs (session_id, timestamp, level, message, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      sessionId,
      new Date().toISOString(),
      level,
      message,
      metadata ? JSON.stringify(metadata) : null,
    );
  }

  static async getSessionLogs(
    sessionId: string,
    limit: number = 100,
  ): Promise<Array<{ timestamp: string; level: string; message: string; metadata?: Record<string, unknown> }>> {
    const rows = db.query<LogRow, [string, number]>(`
      SELECT timestamp, level, message, metadata FROM session_logs
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit);

    return rows.reverse().map((row) => ({
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
    }));
  }

  static async allocateVncPort(sessionId?: string): Promise<number | null> {
    return this.allocatePort("vnc", CONFIG.container.vncPortRangeStart, CONFIG.container.vncPortRangeEnd, sessionId);
  }

  static async releaseVncPort(port: number): Promise<void> {
    this.releasePort("vnc", port);
  }

  static async allocateMcpPort(sessionId?: string): Promise<number | null> {
    return this.allocatePort("mcp", CONFIG.container.mcpPortRangeStart, CONFIG.container.mcpPortRangeEnd, sessionId);
  }

  static async releaseMcpPort(port: number): Promise<void> {
    this.releasePort("mcp", port);
  }

  static async healthCheck(): Promise<boolean> {
    try {
      db.query<CountRow, []>("SELECT COUNT(*) as count FROM sessions").get();
      return true;
    } catch (error) {
      logger.error("SQLite session registry health check failed:", error);
      return false;
    }
  }

  private static async allocatePort(
    kind: "vnc" | "mcp",
    start: number,
    end: number,
    sessionId?: string,
  ): Promise<number | null> {
    for (let port = start; port <= end; port++) {
      try {
        db.query(`
          INSERT INTO allocated_ports (kind, port, session_id, allocated_at)
          VALUES (?, ?, ?, ?)
        `).run(kind, port, sessionId ?? null, new Date().toISOString());
        return port;
      } catch {
        // Try the next port.
      }
    }

    logger.error(`No available ${kind.toUpperCase()} ports`);
    return null;
  }

  private static releasePort(kind: "vnc" | "mcp", port: number): void {
    db.query("DELETE FROM allocated_ports WHERE kind = ? AND port = ?").run(kind, port);
  }
}
