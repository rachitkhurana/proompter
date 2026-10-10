/**
 * Shared entry/session contract (DESIGN §8 file format, §9 plugins).
 *
 * Written by the orchestrator so T07 (store, serializer, composer) and T08 (sheet, ticket, command menu,
 * root) can build in parallel against one shape. T07 owns this file from here on: it may add fields, but
 * renaming or removing one needs a note in its hand-back, since T08 depends on it.
 */

import type { CaptureConsoleEntry, CaptureNetworkEntry, CaptureQuery } from "./capture/types";
import type { ViewportId } from "./surface";

export type EntryStatus = "open" | "progress" | "resolved";
export type EntryIntent = "fix" | "change" | "question" | "approve";
/** One vocabulary everywhere (DESIGN §2 D2.5). */
export type EntryPriority = "blocking" | "important" | "minor";
/** How the target was chosen; the composer's header and the entry body vary with it. */
export type EntryKind = "element" | "multi" | "box" | "text" | "note";

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
  fontsEmbedded: boolean;
}

export interface EntryContext {
  console: CaptureConsoleEntry[];
  network: CaptureNetworkEntry[];
  queries: CaptureQuery[];
  /** e.g. `migrate/main@611df0b`. */
  build?: string;
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
}

/** Store events. The files sink (T09) listens to these. */
export type EntryEvent =
  | { type: "entry:created"; entry: Entry }
  | { type: "entry:updated"; entry: Entry; previous: Entry };
