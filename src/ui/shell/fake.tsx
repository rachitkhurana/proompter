/**
 * In-memory stand-ins for T07's store, serializer and composer, with the prototype's seed data.
 * For stories, unit tests and the e2e fixture only. The real ones are wired in `defaults.ts`.
 */
import { useEffect, useRef, useState } from "react";
import type { Entry, EntryActivity, EntryKind, EntryTarget, Session } from "../../core/entry";
import { assetNames, entryPath, pad } from "../../core/serialize";
import { viewportSize } from "../../core/surface";
import { commitTargets, toEntryTarget } from "../composer/composer";
import { Button } from "../primitives/button";
import type {
  ComposerSlotProps,
  EntryPatch,
  EntryStore,
  PendingFile,
  ProompterDeps,
  Serialize,
  StoreState,
} from "../proompter-deps";

// -- seed ------------------------------------------------------------------------------------------------

export const SEED_SESSION: Session = {
  id: "2026-10-10_manual-test-pass",
  title: "Manual test pass",
  reviewer: "rachit",
  branch: "migrate/main",
  sha: "611df0b",
  env: "local · prod data (redacted)",
  started: "2026-10-10T12:40:00Z",
  version: 1,
};

/** A tiny placeholder "screenshot" (an SVG data URL; real snapshots are PNG data URLs). */
export function placeholderShot(w: number, h: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<rect width='100%' height='100%' fill='#141720'/>` +
    `<rect x='${w * 0.08}' y='${h * 0.14}' width='${w * 0.84}' height='${h * 0.3}' rx='8' fill='#1a1e29' stroke='#ff6363' stroke-width='2'/>` +
    `<rect x='${w * 0.08}' y='${h * 0.52}' width='${w * 0.84}' height='${h * 0.34}' rx='8' fill='#1a1e29'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const T0 = Date.parse("2026-10-10T12:41:07Z");
const CONTEXT = {
  console: [
    { timestamp: T0, level: "error" as const, message: "GET /api/v1/feeds/trending 500 (Internal Server Error)" },
    { timestamp: T0 + 2000, level: "warn" as const, message: "[voice] AudioContext suspended until a user gesture" },
  ],
  network: [
    { timestamp: T0 - 4000, kind: "fetch" as const, method: "GET", url: "/api/v1/feeds?cursor=", status: 200, ok: true, durationMs: 182 },
    { timestamp: T0 - 1000, kind: "fetch" as const, method: "GET", url: "/api/v1/feeds/trending", status: 500, ok: false, durationMs: 911 },
    { timestamp: T0 + 500, kind: "fetch" as const, method: "GET", url: "/api/v1/tournaments/vnc-2291/standings", status: 200, ok: true, durationMs: 240 },
    { timestamp: T0 + 900, kind: "xhr" as const, method: "POST", url: "/api/v1/track/pageview", status: 204, ok: true, durationMs: 41 },
  ],
  queries: [],
  build: "migrate/main@611df0b",
};

function target(source: string | null, label: string, component: string, selector: string, inherited = false): EntryTarget {
  return { selector, source, sourceInherited: inherited, label, component };
}

type Seed = Partial<Entry> & Pick<Entry, "n" | "title" | "status" | "intent" | "priority" | "viewport">;

function seedEntry(s: Seed): Entry {
  const size = viewportSize(s.viewport, false) ?? { width: 1280, height: 800 };
  const created = `2026-10-10T12:${pad(40 + s.n, 2)}:00Z`;
  const t = s.target ?? target(null, "Page", "Page", "body");
  return {
    id: `PRO-${s.n}`,
    session: SEED_SESSION.id,
    kind: "element",
    description: "",
    rotated: false,
    size,
    route: "/feeds",
    targets: [t],
    target: t,
    tags: [],
    issue: null,
    created,
    updated: created,
    context: CONTEXT,
    activity: [{ at: created, who: "rachit", text: "created" }],
    ...s,
  };
}

/** The prototype's entries (one per status, one without a snapshot), filed on `route`. */
export function seedEntries(route = "/feeds"): Entry[] {
  return seedList().map((e) => ({ ...e, route }));
}

function seedList(): Entry[] {
  return [
    seedEntry({
      n: 1,
      title: "Standings show the squad ID instead of its name after finalize",
      description:
        'Row 2 reads "#1042". The name appears after a refresh, so the finalize response probably comes back without the joined squad.',
      status: "open",
      intent: "fix",
      priority: "blocking",
      viewport: "responsive",
      target: target(
        "src/app/(app)/tournaments/[slugId]/_organise/standings/standings-panel.tsx:87:5",
        "StandingsPanel",
        "TournamentDetail › StandingsPanel › StandingsRow",
        '[data-src="standings-panel.tsx:87:5"]',
      ),
      task: "T-tournament-standings-edit",
      testPlan: "§6 Tournaments, organiser",
      tags: ["data", "regression"],
      issue: "#481",
      snapshot: { element: placeholderShot(480, 220), viewport: placeholderShot(1280, 800), fontsEmbedded: true },
      activity: [
        { at: "2026-10-10T12:41:00Z", who: "rachit", text: "created" },
        { at: "2026-10-10T12:45:00Z", who: "rachit", text: "opened GitHub issue #481" },
      ],
    }),
    seedEntry({
      n: 2,
      title: "Like counts twice on a double-tap",
      description: "The count jumps by two for a moment before it settles.",
      status: "progress",
      intent: "change",
      priority: "minor",
      viewport: "responsive",
      target: target(
        "src/components/gamorite/feed/post-actions.tsx:21:7",
        "PostActions",
        "PostCard › PostActions",
        '[data-src="post-actions.tsx:21:7"]',
      ),
      task: "T-feed-home",
      tags: ["ui"],
      snapshot: { element: placeholderShot(360, 120), fontsEmbedded: false },
    }),
    seedEntry({
      n: 3,
      title: "Should the voice chip show who is speaking?",
      description: "Right now it shows the room name and member count only.",
      status: "open",
      intent: "question",
      priority: "important",
      viewport: "responsive",
      target: target(
        "src/components/voice/voice-chip/voice-chip.tsx:29:5",
        "VoiceChip",
        "AppShell › VoiceChip",
        '[data-src="voice-chip.tsx:29:5"]',
      ),
      testPlan: "§7 Voice",
      tags: ["ui"],
      snapshot: { element: placeholderShot(300, 90), viewport: placeholderShot(1280, 800), fontsEmbedded: true },
    }),
    seedEntry({
      n: 4,
      title: "Feed tabs wrap under the title at 390px",
      description: "Keep the title and tabs on one row, or move the tabs into a horizontal scroll row.",
      status: "resolved",
      intent: "fix",
      priority: "important",
      viewport: "mobile",
      target: target(
        "src/app/(app)/feeds/_components/feed-tabs.tsx:18:5",
        "FeedTabs",
        "FeedPage › FeedTabs",
        '[data-src="feed-tabs.tsx:18:5"]',
        true,
      ),
      task: "T-feed-home",
      tags: ["ui", "mobile"],
      // No snapshot: shows "Show on mobile".
      activity: [
        { at: "2026-10-10T12:44:00Z", who: "rachit", text: "created" },
        { at: "2026-10-10T13:02:00Z", who: "rachit", text: "status: open → resolved" },
      ],
    }),
  ];
}

// -- store -----------------------------------------------------------------------------------------------

export interface FakeStore extends EntryStore {
  /** Add an entry (what the composer does). */
  add(entry: Entry): void;
  /** Number of `write()` calls so far. */
  readonly writes: number;
}

export interface FakeInit {
  session?: Session;
  entries?: Entry[];
  /** Route the seeded entries were filed on (default `/feeds`). Ignored when `entries` is given. */
  route?: string;
  /** `false`: start with every entry waiting to be written (the Publish tab has files to show). */
  written?: boolean;
}

export function createFakeStore(init?: FakeInit): FakeStore {
  const session = init?.session ?? SEED_SESSION;
  const unwritten = new Set<string>();
  let writes = 0;
  const listeners = new Set<() => void>();

  const pendingFor = (entries: readonly Entry[]): PendingFile[] => {
    const list = entries.filter((e) => unwritten.has(e.id));
    if (list.length === 0) return [];
    return [
      { path: "session.md", change: "modify" },
      ...list.flatMap((e): PendingFile[] => [
        { path: entryPath(e), change: "add" },
        { path: `assets/${assetNames(e.n, e.viewport).element}`, change: "add" },
      ]),
    ];
  };

  const entries0 = init?.entries ?? seedEntries(init?.route);
  if (init?.written === false) entries0.forEach((e) => unwritten.add(e.id));
  let state: StoreState = { session, entries: entries0, pending: pendingFor(entries0) };

  const set = (entries: readonly Entry[]) => {
    state = { session, entries, pending: pendingFor(entries) };
    listeners.forEach((l) => l());
  };

  const patchEntry = (id: string, patch: EntryPatch, who: string) => {
    const old = state.entries.find((e) => e.id === id);
    if (!old) return;
    const at = new Date().toISOString();
    const activity: EntryActivity[] = [];
    for (const k of ["status", "priority", "intent"] as const) {
      const v = patch[k];
      if (v && v !== old[k]) activity.push({ at, who, text: `${k}: ${old[k]} → ${v}` });
    }
    const { testPlan, ...rest } = patch;
    const next: Entry = {
      ...old,
      ...rest,
      ...(testPlan === undefined ? {} : { testPlan: testPlan ?? undefined }),
      updated: at,
      activity: [...old.activity, ...activity],
    };
    if (testPlan === null) delete next.testPlan;
    unwritten.add(id);
    set(state.entries.map((e) => (e.id === id ? next : e)));
  };

  return {
    getSnapshot: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    update: patchEntry,
    resolve: (id, who) => patchEntry(id, { status: "resolved" }, who),
    write() {
      writes++;
      unwritten.clear();
      set(state.entries);
      return Promise.resolve();
    },
    add(entry) {
      unwritten.add(entry.id);
      set([...state.entries, entry]);
    },
    get writes() {
      return writes;
    },
  };
}

// -- serializer ------------------------------------------------------------------------------------------

/** A small stand-in for DESIGN §8 (not the real file format). */
export const fakeSerialize: Serialize = (e, s) =>
  [
    "---",
    `id: ${e.id}`,
    `session: ${s.id}`,
    `status: ${e.status}`,
    `intent: ${e.intent}`,
    `priority: ${e.priority}`,
    `viewport: ${e.viewport} ${e.size.width}x${e.size.height}`,
    `route: ${e.route}`,
    `source: ${e.target?.source ?? "page"}`,
    `source_inherited: ${e.target?.sourceInherited ?? false}`,
    `selector: ${e.target?.selector ?? "n/a"}`,
    `tags: [${e.tags.join(", ")}]`,
    `issue: ${e.issue ?? "null"}`,
    "---",
    "",
    `# ${e.title}`,
    "",
    e.quote ? `> ${e.quote}\n` : "",
    e.description,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

export const fakeEntryPath = (e: Entry, s: Session) => `reviews/${s.id}/${entryPath(e)}`;

// -- composer --------------------------------------------------------------------------------------------

/** A bare-bones composer for tests and the fixture: a title, `⌘↵` to create. T07's replaces it. */
function FakeComposer({ props, store }: { props: ComposerSlotProps; store: FakeStore }) {
  const { commit, surface, viewport, rotated, session, getCapture, onClose, onCreated } = props;
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const create = () => {
    if (!title.trim()) {
      setError(true);
      input.current?.focus();
      return;
    }
    const entries = store.getSnapshot().entries;
    const n = entries.reduce((m, e) => Math.max(m, e.n), 0) + 1;
    const targets = commitTargets(commit).map(toEntryTarget);
    const ctx = getCapture().context();
    const now = new Date().toISOString();
    const entry: Entry = {
      id: `PRO-${n}`,
      n,
      session: session.id,
      status: "open",
      intent: "fix",
      priority: "important",
      kind: commit.kind as EntryKind,
      title: title.trim(),
      description: "",
      viewport,
      size: surface?.size() ?? { width: window.innerWidth, height: window.innerHeight },
      rotated,
      route: surface?.win.location.pathname ?? window.location.pathname,
      ...(targets[0] ? { target: targets[0] } : {}),
      targets,
      ...(commit.kind === "text" ? { quote: commit.quote } : {}),
      tags: [],
      issue: null,
      created: now,
      updated: now,
      context: { console: ctx.console, network: ctx.network, queries: ctx.queries },
      activity: [{ at: now, who: session.reviewer, text: "created" }],
    };
    store.add(entry);
    onCreated(entry);
  };

  return (
    <div
      role="dialog"
      aria-label="New entry"
      style={{
        position: "fixed",
        left: "50%",
        top: "16vh",
        translate: "-50% 0",
        width: "min(500px, calc(100vw - 24px))",
        zIndex: 90,
        display: "grid",
        gap: 8,
        padding: 16,
        borderRadius: 16,
        background: "var(--mat-2)",
        boxShadow: "var(--sh-3), var(--edge)",
        color: "var(--fg)",
        font: "400 13px/20px var(--sans)",
      }}
    >
      <input
        ref={input}
        aria-label="Title"
        placeholder="Title"
        autoComplete="off"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            create();
          }
        }}
        style={{ font: "600 16px/24px var(--sans)", background: "transparent", border: 0, outline: "none", color: "var(--fg)", width: "100%" }}
      />
      {error ? (
        <div role="alert" style={{ color: "var(--p-blocking)", font: "400 12px/16px var(--sans)" }}>
          Add a title.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="pri" onClick={create}>
          Create entry
        </Button>
      </div>
    </div>
  );
}

export interface FakeDeps extends ProompterDeps {
  store: FakeStore;
}

/** Store + serializer + composer, all in memory. */
export function createFakeDeps(init?: FakeInit): FakeDeps {
  const store = createFakeStore(init);
  return {
    store,
    serialize: fakeSerialize,
    entryPath: fakeEntryPath,
    composer: (props) => <FakeComposer props={props} store={store} />,
  };
}
