/**
 * The seams between the root component (T08) and the store, serializer and composer (T07).
 *
 * T08 builds against these small interfaces so it never imports `src/core/store.ts`, `serialize.ts`,
 * `plugins.ts` or `src/ui/composer/**`. `<Proompter>` takes a `deps` prop; when it is absent the defaults in
 * `src/ui/shell/defaults.tsx` apply (T07's store, serializer and composer).
 *
 * Types only: nothing here runs, so the light entry chunk can import it freely.
 */
import type { ReactNode, RefObject } from "react";
import type { Capture, CaptureOptions } from "../core/capture/types";
import type {
  Entry,
  EntryIntent,
  EntryPriority,
  EntryStatus,
  ProompterPlugin,
  Session,
} from "../core/entry";
import type { PickCommit } from "../core/pick";
import type { PickSurface, ViewportId } from "../core/surface";

/** Fields the ticket can edit. `testPlan: null` unlinks. The store appends the activity line. */
export interface EntryPatch {
  status?: EntryStatus;
  priority?: EntryPriority;
  intent?: EntryIntent;
  tags?: string[];
  testPlan?: string | null;
}

/** One file the next write would create or change, relative to `reviews/<session>/`. */
export interface PendingFile {
  path: string;
  change: "add" | "modify";
}

/** GitHub sync (D16) as the Publish tab shows it. Present only when `<Proompter github>` is set. */
export interface GithubStatus {
  /** Entries not yet sent in their current state. */
  pending: number;
  /** Message of the last failed sync, else null. */
  error: string | null;
  /** The route answered 401: show the review key field. */
  needsKey: boolean;
  /** Issue URL per entry id (entries synced in this page load). */
  urls: Readonly<Record<string, string>>;
}

/** What a sync did, for the status line. */
export interface GithubSyncOutcome {
  ok: boolean;
  synced: number;
  resolved: number;
  error?: string;
  needsKey?: boolean;
}

export interface StoreState {
  session: Session;
  entries: readonly Entry[];
  /** Files not yet written to disk (the Publish tab's tree). Empty when everything is written. */
  pending: readonly PendingFile[];
  github?: GithubStatus;
}

/** What the sheet, ticket and command menu need from the entry store. */
export interface EntryStore {
  /** Must return the same object until something changes (it feeds `useSyncExternalStore`). */
  getSnapshot(): StoreState;
  subscribe(listener: () => void): () => void;
  update(id: string, patch: EntryPatch, who: string): void;
  resolve(id: string, who: string): void;
  /** Publish tab: write the pending files. Absent when the sink is unavailable (button disabled). */
  write?(): Promise<void>;
  /**
   * Publish tab: sync with GitHub. `key` is the review key the reviewer just typed (kept in localStorage).
   * Absent without `<Proompter github>`.
   */
  syncGithub?(key?: string): Promise<GithubSyncOutcome>;
  /** v2: open a GitHub issue. Absent in v1 (the ticket shows a read-only "v2" row). */
  openIssue?(id: string, who: string): void;
}

/** DESIGN §8 text of one entry. Called for the ticket's File preview and for "Copy for agent". */
export type Serialize = (entry: Entry, session: Session) => string;

export interface ComposerSlotProps {
  /** What was picked (element, multi, box, text or note). */
  commit: PickCommit;
  /** The surface being reviewed (the live page or the device frame). */
  surface: PickSurface | null;
  viewport: ViewportId;
  rotated: boolean;
  session: Session;
  plugins: readonly ProompterPlugin[];
  /** The capture bound to the surface being reviewed, read when the entry is created. */
  getCapture(): Capture;
  /**
   * Close without creating. The ROOT handles Esc (menu, composer, command menu, ... order), so the composer
   * must not handle Esc itself; it only calls this from its Cancel and close buttons.
   */
  onClose(): void;
  /**
   * The composer attaches its `discard()` here (T07's `ref`), so the root's Esc can close it with its exit
   * animation. A composer without one is simply closed with `onClose`.
   */
  discardRef: RefObject<{ discard(): void } | null>;
  /**
   * The entry was created (the store already has it). The root closes the composer, clears the selection,
   * shows the "saved" toast and pulses the new pin, so the composer must not toast.
   */
  onCreated(entry: Entry): void;
}

/** Renders the composer for `commit`. T07's real composer is adapted to this at integration. */
export type ComposerSlot = (props: ComposerSlotProps) => ReactNode;

export interface ProompterDeps {
  store: EntryStore;
  serialize: Serialize;
  /** Repo-relative path of an entry's file, e.g. `reviews/2026-10-10_pass/entries/005-avatar-cropped.md`. */
  entryPath(entry: Entry, session: Session): string;
  composer: ComposerSlot;
}

/**
 * What must outlive the UI chunk mounting and unmounting (hiding the kit with `⌘⇧.` keeps the session and the
 * console and network buffers): the deps, and the host window's capture. The light entry chunk owns one; the
 * lazy UI chunk fills it.
 */
export interface DepsBox {
  deps?: ProompterDeps;
  capture?: Capture;
}

export interface ProompterSessionInput {
  reviewer?: string;
  title?: string;
}

export interface ProompterProps {
  session?: ProompterSessionInput;
  plugins?: ProompterPlugin[];
  /** Query-cache adapter (DESIGN §5), forwarded to capture. */
  queries?: CaptureOptions["queries"];
  /** Host redaction hook, forwarded to capture. */
  redact?: CaptureOptions["redact"];
  /** URL of the dev file-writer route (`app/api/proompter/route.ts` in the host). Default `/api/proompter`. */
  endpoint?: string;
  /**
   * Turn on GitHub sync (D16): the Publish tab gets a "Sync to GitHub" button. `endpoint` is where the host
   * mounted `createGithubRoute` (default `/api/proompter/github`).
   */
  github?: { endpoint?: string };
  /**
   * Where reviews are saved: `"files"` (./reviews/ through the dev route), `"github"` (issues, with screenshots on
   * an orphan assets branch; no entry files anywhere) or `"both"`. Default `"both"` when `github` is set, else
   * `"files"`; `"github"` and `"both"` need the `github` prop. `"github"` needs the route at 0.2.0 or later.
   */
  save?: "files" | "github" | "both";
  /** Inject the store, serializer and composer (stories, tests, fixtures). Defaults to the real ones. */
  deps?: ProompterDeps;
  /** Start with the kit shown. By default it stays hidden until `⌘⇧.` or `window.__proompter.open()`. */
  defaultOpen?: boolean;
  /** @internal Stylesheet for the shadow root. Tests pass `""` (happy-dom never fires `animationend`). */
  shadowCss?: string;
  /** @internal Page the device viewports frame. Tests pass `about:blank`; by default it is the current URL. */
  frameSrc?: string;
}

/** `window.__proompter` (DESIGN §3). */
export interface ProompterApi {
  open(): void;
  close(): void;
  toggle(): void;
  /** Preview builds (D15): turn the kit on (persisted in localStorage), start capture and open it. */
  enable(): void;
  /** Turn it off again: close, stop capture, back to dormant. */
  disable(): void;
  /** Whether the kit is active. Always true in development. */
  enabled(): boolean;
  /** The session's entries. Empty while dormant, and until the kit has been opened once (the store loads with the UI chunk). */
  entries(): readonly Entry[];
}

declare global {
  interface Window {
    __proompter?: ProompterApi;
    /** Frame mode: the capture the framed page exposes to the parent kit. */
    __proompter_capture?: Capture;
  }
}
