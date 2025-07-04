/**
 * /**
 *  * Generated by orval v1.0.0 🍺
 *  * Do not edit manually.
 *  * Sigflow API
 *  * OpenAPI spec version: 0.1.0
 *  *\/
 */
import type { PostSession200TwoStatus } from "./postSession200TwoStatus";

export type PostSession200Two = {
  /** Unique session identifier */
  session_id: string;
  status: PostSession200TwoStatus;
  /** URL to access the VNC session */
  vnc_url: string;
  /** WebSocket URL for chat communication */
  chat_url: string;
  created_at: string;
  expires_at: string;
};
