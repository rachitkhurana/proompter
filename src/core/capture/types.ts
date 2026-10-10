/**
 * Capture types.
 *
 * `Surface` and `Rect` live in `../surface` (the one definition: `{ doc, win, toScreen(rect), scale }`, DESIGN §6).
 * They are re-exported here for code that imports them from capture. Capture only reads `doc` and `win`.
 */
import type { Rect, Surface } from "../surface";

export type { Rect, Surface };

export interface CaptureConsoleEntry {
  /** Epoch ms. */
  timestamp: number;
  level: "error" | "warn";
  message: string;
  /** First stack frame, e.g. `at Foo (http://host/app.js:1:2)`. */
  frame?: string;
}

export interface CaptureNetworkEntry {
  timestamp: number;
  kind: "fetch" | "xhr";
  method: string;
  url: string;
  /** HTTP status, or null when the request failed before a response (network error, abort). */
  status: number | null;
  ok: boolean;
  durationMs: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  /** Redacted, at most 2048 chars. */
  requestExcerpt?: string;
  responseExcerpt?: string;
}

export type CaptureEntry = CaptureConsoleEntry | CaptureNetworkEntry;

export interface CaptureQuery {
  key: unknown;
  status: string;
  updatedAt: number;
}

export interface CaptureInternalError {
  timestamp: number;
  where: string;
  message: string;
}

export interface CaptureContext {
  console: CaptureConsoleEntry[];
  network: CaptureNetworkEntry[];
  queries: CaptureQuery[];
  /** Errors swallowed inside capture (never thrown into the host). */
  internalErrors: CaptureInternalError[];
}

export interface SnapshotResult {
  /** PNG data URL of the element (with padding); absent when no element was given or capture failed. */
  element?: string;
  /** PNG data URL of the visible viewport; absent when capture failed. */
  viewport?: string;
  /** False when font embedding failed (e.g. CORS) and system fonts were used instead. */
  fontsEmbedded: boolean;
  error?: string;
}

export interface CaptureOptions {
  win: Window & typeof globalThis;
  /** Host hook, runs after built-in redaction. Return null/undefined to drop the entry. */
  redact?: (entry: CaptureEntry) => CaptureEntry | null | undefined;
  queries?: () => Array<{ key: unknown; status: string; updatedAt: number }>;
}

export interface Capture {
  enable(): void;
  disable(): void;
  context(): CaptureContext;
  snapshot(surface: Surface, el?: Element): Promise<SnapshotResult>;
}
