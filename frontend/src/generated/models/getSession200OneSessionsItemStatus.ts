/**
 * /**
 *  * Generated by orval v1.0.0 🍺
 *  * Do not edit manually.
 *  * Sigflow API
 *  * OpenAPI spec version: 0.1.0
 *  *\/
 */

/**
 * Current status of the session
 */
export type GetSession200OneSessionsItemStatus =
  (typeof GetSession200OneSessionsItemStatus)[keyof typeof GetSession200OneSessionsItemStatus];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const GetSession200OneSessionsItemStatus = {
  initializing: "initializing",
  ready: "ready",
  running: "running",
  terminating: "terminating",
  terminated: "terminated",
  error: "error",
} as const;
