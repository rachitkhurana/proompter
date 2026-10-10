/**
 * Shared entry/session contract (DESIGN §8 file format, §9 plugins).
 *
 * Written by the orchestrator so T07 (store, serializer, composer) and T08 (sheet, ticket, command menu,
 * root) can build in parallel against one shape. T07 owns this file from here on: it may add fields, but
 * renaming or removing one needs a note in its hand-back, since T08 depends on it.
 */

import type { CaptureConsoleEntry, CaptureNetworkEntry, CaptureQuery } from "./capture/types";
import type { ViewportId } from "./surface";

export const ENTRY_STATUSES = ["open", "progress", "resolved"] as const;
export const ENTRY_INTENTS = ["fix", "change", "question", "approve"] as const;
/** One vocabulary everywhere (DESIGN §2 D2.5). */
export const ENTRY_PRIORITIES = ["blocking", "important", "minor"] as const;
/** How the target was chosen; the composer's header and the entry body vary with it. */
export const ENTRY_KINDS = ["element", "multi", "box", "text", "note"] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export type EntryIntent = (typeof ENTRY_INTENTS)[number];
export type EntryPriority = (typeof ENTRY_PRIORITIES)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** One picked element. Multi and box entries carry several. */
export interface EntryTarget {
  selector: string;
  /** `path:line:col`, or null when nothing in the chain is stamped. */
  source: string | null;
  sourceInherited: boolean;
  label: string;
  /** Component chain, e.g. `FeedPage › PostCard › Avatar`. */
  component: string;
}

export interface EntrySnapshot {
  /** Element crop, PNG data URL (in memory / IndexedDB). The files sink writes it to `assets/`. */
  element?: string;
  /** Visible viewport, PNG data URL. */
  viewport?: string;
  /**
   * T07: optional (was required). Not recorded in the markdown file, so an entry parsed from a file does not
   * know it. `undefined` means "unknown".
   */
  fontsEmbedded?: boolean;
  /**
   * T07: file names inside `assets/` the sink should write (or, on a parsed entry, the one the file links to):
   * `005-mobile.png` and `005-mobile-full.png`. Set by `store.create` from the entry number.
   */
  assets?: { element?: string; viewport?: string };
}

/**
 * T07: what the markdown file says about the captured context (counts plus the one-line items). The full
 * arrays are not in the file. `parse()` fills this in; `serialize()` uses it when the arrays are empty.
 */
export interface ContextSummary {
  consoleLines: number;
  consoleErrors: number;
  /** `error GET /api/v1/feeds/trending 500`, `warn [voice] AudioContext suspended` (one per console line). */
  consoleItems: string[];
  networkTotal: number;
  networkFailed: number;
  /** `GET /api/v1/feeds/trending → 500 (911 ms)` (failed requests only). */
  networkItems: string[];
}

export interface EntryContext {
  console: CaptureConsoleEntry[];
  network: CaptureNetworkEntry[];
  queries: CaptureQuery[];
  /** e.g. `migrate/main@611df0b`. */
  build?: string;
  /** T07: set on entries parsed from a file (the arrays above are then empty). */
  summary?: ContextSummary;
}

export interface EntryActivity {
  at: string; // ISO timestamp
  who: string;
  /** e.g. `created`, `status: open → progress`, `priority: minor → important`. */
  text: string;
}

export interface Entry {
  /** `PRO-<n>`. */
  id: string;
  /** T07 (D3.2): fully qualified `<session>/PRO-n`, written to the file as `ref:`. Derived when absent. */
  ref?: string;
  /** 1-based number within the session; the `NNN` in file names. */
  n: number;
  /** Session folder name, `<YYYY-MM-DD>_<slug>`. */
  session: string;
  status: EntryStatus;
  intent: EntryIntent;
  priority: EntryPriority;
  kind: EntryKind;
  title: string;
  description: string;
  viewport: ViewportId;
  /** Exact surface size when filed, e.g. `{ width: 390, height: 844 }`. */
  size: { width: number; height: number };
  rotated: boolean;
  route: string;
  /** Primary target (first of `targets`), absent for page notes. */
  target?: EntryTarget;
  targets: EntryTarget[];
  /** Text mode: the quoted selection. */
  quote?: string;
  task?: string;
  testPlan?: string;
  /** The note left by `proompter resolve --note` (T15), written as a `## Resolution` section. */
  resolution?: string;
  /** Agent replies (T16), written as a `## Replies` section of `- <who> (<date>): <text>` lines. */
  replies?: string;
  tags: string[];
  issue: string | null;
  created: string; // ISO
  updated: string; // ISO
  context: EntryContext;
  snapshot?: EntrySnapshot;
  activity: EntryActivity[];
  /** Extra frontmatter from plugins' `context()`. */
  extra?: Record<string, unknown>;
}

export interface Session {
  /** Folder name, `<YYYY-MM-DD>_<slug>`. */
  id: string;
  title: string;
  reviewer: string;
  branch?: string;
  sha?: string;
  env?: string;
  started: string; // ISO
  /** File format version (`proompter: 1` in session.md). */
  version: 1;
}

export interface ProompterPlugin {
  name: string;
  taskFor?(t: { source?: string; route: string }): string | null;
  context?(): Record<string, unknown>;
  testPlan?: string[];
  redact?(entry: Entry): Entry;
  /** CSS selectors to black out in PNG snapshots, on top of inputs and `[data-proompter-redact]`. */
  redactSnapshot?: string[];
}

/** Store events. The files sink (T09) listens to these. */
export type EntryEvent =
  | { type: "entry:created"; entry: Entry }
  | { type: "entry:updated"; entry: Entry; previous: Entry };
