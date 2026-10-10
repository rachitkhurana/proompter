/** Shared by the composer's stories and tests: a stub capture, an in-memory store, a sample plugin, a mock page. */
import type { Capture, CaptureContext, SnapshotResult } from "../../core/capture";
import type { ProompterPlugin } from "../../core/entry";
import { CONSOLE, NETWORK, PNG } from "../../core/entry-fixtures.test-util";
import { createStore, type EntryStore, type StoreOptions } from "../../core/store";

export interface StubCaptureOptions {
  context?: Partial<CaptureContext>;
  snapshot?: SnapshotResult | (() => Promise<SnapshotResult>);
}

export function createStubCapture(opts: StubCaptureOptions = {}): Capture & { snapshots: number } {
  const stub = {
    enabled: true,
    snapshots: 0,
    enable() {},
    disable() {},
    clear() {},
    context(): CaptureContext {
      return { console: CONSOLE, network: NETWORK, queries: [], internalErrors: [], ...opts.context };
    },
    async snapshot(): Promise<SnapshotResult> {
      stub.snapshots++;
      const s = opts.snapshot;
      if (typeof s === "function") return s();
      return s ?? { element: PNG, viewport: PNG, fontsEmbedded: true };
    },
  };
  return stub;
}

/** In memory only (`idb: null`), so stories and tests never touch IndexedDB. */
export function createMemoryStore(opts: Partial<StoreOptions> = {}): EntryStore {
  return createStore({
    session: { title: "Manual test pass", reviewer: "rachit", branch: "migrate/main", sha: "611df0b", env: "local" },
    idb: null,
    ...opts,
  });
}

/** A host plugin like Gamorite's: a task from the source path, plus a test plan. */
export const samplePlugin: ProompterPlugin = {
  name: "sample-tasks",
  taskFor: ({ source }) => (source?.includes("post-card") || source?.includes("avatar") ? "T-feed-home" : null),
  testPlan: ["§2 Feed and posts", "§5 Tournaments, player", "§6 Tournaments, organiser", "§7 Voice", "§11 Cross-cutting"],
};

export const MOCK_PAGE_ATTR = "data-pm-mock-page";

/**
 * A small stamped page (the way the loader would leave one) in the light DOM, for stories and tests that need
 * real elements to resolve. Returns the elements by id and a `dispose`.
 */
export function mountMockPage(): { els: Record<"card" | "avatar" | "ring" | "text" | "share" | "bare", HTMLElement>; dispose(): void } {
  const host = document.createElement("div");
  host.setAttribute(MOCK_PAGE_ATTR, "");
  host.style.cssText = "position:fixed;left:56px;top:120px;width:420px;font:14px system-ui,sans-serif;color:#e4e4e7;";
  host.innerHTML = `
    <article id="card" data-src="src/app/(app)/feeds/_components/post-card.tsx:48:7" data-comp="FeedPage › PostCard" style="padding:16px;border-radius:12px;background:#18181b">
      <header data-src="src/app/(app)/feeds/_components/post-header.tsx:12:5" data-comp="PostHeader" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
        <div id="avatar" data-src="src/components/gamorite/avatar.tsx:9:3" data-comp="Avatar" style="width:44px;height:44px;border-radius:50%;background:#3f3f46;display:grid;place-items:center">
          <span id="ring" style="width:30px;height:30px;border-radius:50%;box-shadow:0 0 0 2px #ff6363"></span>
        </div>
        <div><b>Mira</b><div style="color:#a1a1aa;font-size:12px">2 min ago</div></div>
      </header>
      <p id="text" data-src="src/app/(app)/feeds/_components/post-card.tsx:61:9" style="margin:0 0 12px">Clutched a 1v4 in the final round and the whole lobby lost it.</p>
      <div id="bare" style="height:60px;border-radius:8px;background:#27272a;margin-bottom:12px"></div>
      <button id="share" data-src="src/app/(app)/feeds/_components/post-actions.tsx:21:7" style="padding:6px 12px;border-radius:8px;border:0;background:#3f3f46;color:#fff">Share</button>
    </article>`;
  document.body.appendChild(host);
  const get = (id: string) => host.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  return {
    els: { card: get("card"), avatar: get("avatar"), ring: get("ring"), text: get("text"), share: get("share"), bare: get("bare") },
    dispose: () => host.remove(),
  };
}
