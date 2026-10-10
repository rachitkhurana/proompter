/** Entries for tests and stories: the DESIGN §8 example, with overrides. */
import type { CaptureConsoleEntry, CaptureNetworkEntry } from "./capture/types";
import type { Entry, EntryTarget, Session } from "./entry";

export const SOURCE = "src/app/(app)/feeds/_components/post-card.tsx:48:7";

export const CONSOLE: CaptureConsoleEntry[] = [
  { timestamp: Date.UTC(2026, 9, 10, 12, 41, 7), level: "error", message: "GET /api/v1/feeds/trending 500" },
  {
    timestamp: Date.UTC(2026, 9, 10, 12, 41, 9),
    level: "warn",
    message: "[voice] AudioContext suspended until a user gesture",
  },
];

const net = (method: string, url: string, status: number, durationMs: number): CaptureNetworkEntry => ({
  timestamp: Date.UTC(2026, 9, 10, 12, 41, 8),
  kind: "fetch",
  method,
  url,
  status,
  ok: status < 400,
  durationMs,
});

export const NETWORK: CaptureNetworkEntry[] = [
  net("GET", "/api/v1/feeds?cursor=", 200, 182),
  net("GET", "/api/v1/feeds/trending", 500, 911),
  net("GET", "/api/v1/tournaments/vnc-2291/standings", 200, 240),
  net("POST", "/api/v1/track/pageview", 204, 41),
];

export const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function makeTarget(over: Partial<EntryTarget> = {}): EntryTarget {
  return {
    selector: `[data-src="${SOURCE}"] > div:nth-of-type(1) > div:nth-of-type(1)`,
    source: SOURCE,
    sourceInherited: true,
    label: "Avatar",
    component: "FeedPage › FeedList › PostCard › PostHeader › Avatar",
    ...over,
  };
}

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: "2026-10-10_manual-test-pass",
    title: "Manual test pass",
    reviewer: "rachit",
    branch: "migrate/main",
    sha: "611df0b",
    env: "local · prod data (redacted)",
    started: "2026-10-10T12:40:00Z",
    version: 1,
    ...over,
  };
}

/** The entry from DESIGN §8: PRO-5, inherited source, mobile 390x844. */
export function makeEntry(over: Partial<Entry> = {}): Entry {
  const target = makeTarget();
  return {
    id: "PRO-5",
    n: 5,
    session: "2026-10-10_manual-test-pass",
    status: "open",
    intent: "fix",
    priority: "important",
    kind: "element",
    title: "Avatar is cropped on mobile",
    description: "Description as written.",
    viewport: "mobile",
    size: { width: 390, height: 844 },
    rotated: false,
    route: "/feeds",
    target,
    targets: [target],
    task: "T-feed-home",
    testPlan: "§2 Feed and posts",
    tags: ["ui"],
    issue: null,
    created: "2026-10-10T12:42:07Z",
    updated: "2026-10-10T12:42:07Z",
    context: {
      console: CONSOLE.map((c) => ({ ...c })),
      network: NETWORK.map((n) => ({ ...n })),
      queries: [],
      build: "migrate/main@611df0b",
    },
    snapshot: { element: PNG, viewport: PNG, fontsEmbedded: true, assets: { element: "005-mobile.png", viewport: "005-mobile-full.png" } },
    activity: [{ at: "2026-10-10T12:42:07Z", who: "rachit", text: "created" }],
    ...over,
  };
}
