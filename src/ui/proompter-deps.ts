/**
 * The seams between the root component (T08) and the store, serializer and composer (T07).
 *
 * T08 builds against these small interfaces so it never imports `src/core/store.ts`, `serialize.ts`,
 * `plugins.ts` or `src/ui/composer/**`. `<Proompter>` takes a `deps` prop; when it is absent the defaults in
 * `src/ui/shell/defaults.ts` apply (that file holds the single `INTEGRATION(T07)` marker).
 *
 * Types only: nothing here runs, so the light entry chunk can import it freely.
 */
import type { ReactNode } from "react";
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

export interface StoreState {
  session: Session;
  entries: readonly Entry[];
  /** Files not yet written to disk (the Publish tab's tree). Empty when everything is written. */
  pending: readonly PendingFile[];
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
  /** The session's entries. Empty until the kit has been opened once (the store loads with the UI chunk). */
  entries(): readonly Entry[];
}

declare global {
  interface Window {
    __proompter?: ProompterApi;
    /** Frame mode: the capture the framed page exposes to the parent kit. */
    __proompter_capture?: Capture;
  }
}
