import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { makeEntry, makeSession } from "./entry-fixtures.test-util";
import { createFakeIdb } from "./fake-idb.test-util";
import { parse, serialize } from "./serialize";
import { createStore, type NewEntry } from "./store";

/**
 * Merge blocker (GAMORITE PLAN): no secret may reach a sink through ANY string field. The test poisons every
 * string leaf of a draft entry (found by walking it, not from a hand-written list, so a field added to `Entry`
 * later is covered automatically), files it through the real create path with a fake IndexedDB, and looks for the
 * secrets in the markdown, the IndexedDB records, the `entry:created` event and the store state.
 */

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz";
const TOKEN = "tok_SECRET123";
const EMAIL = "bob@example.com";
/** One string that every redactor (text, URL, string) has to clean. */
const SECRET = `Bearer ${TOKEN} ${JWT} ${EMAIL}`;
const LEAKS = [TOKEN, JWT, "eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", EMAIL, "SECRET123"];

/** Leaves that must stay as they are: enums and timestamps the format parses, and the picture. */
const KEEP = new Set(["kind", "status", "intent", "priority", "viewport", "created", "updated", "level", "method", "at", "who", "snapshot"]);

let poisoned = 0;
function poison<T>(v: T, key = ""): T {
  if (typeof v === "string") {
    if (KEEP.has(key)) return v;
    poisoned++;
    return `${v} ${SECRET}` as T;
  }
  if (Array.isArray(v)) return v.map((x) => poison(x, key)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP.has(k) && typeof x === "object" ? x : poison(x, k)])) as T;
  }
  return v;
}

function draftFor(kind: Entry["kind"]): NewEntry {
  const e = makeEntry({ kind, quote: kind === "text" ? "quoted words" : undefined, issue: "#1" });
  e.route = "/feeds?access_token=" + TOKEN;
  e.extra = { owner: "dana", authToken: TOKEN, nested: { deep: "x", token: TOKEN, list: ["y", { apiKey: TOKEN }] } };
  e.context.queries = [{ key: ["feeds", "x"], status: "success", updatedAt: 1 }];
  e.context.network = e.context.network.map((n, i) => ({
    ...n,
    url: `${n.url}${n.url.includes("?") ? "&" : "?"}n=${i}`,
    requestHeaders: { "x-note": "a" },
    responseHeaders: { "x-note": "b" },
    requestExcerpt: "req",
    responseExcerpt: "res",
    error: "boom",
  }));
  e.context.console = e.context.console.map((c) => ({ ...c, frame: "at f (http://x.test/app.js:1:2)" }));
  e.context.summary = {
    consoleLines: 1,
    consoleErrors: 1,
    consoleItems: ["error x"],
    networkTotal: 1,
    networkFailed: 1,
    networkItems: ["GET /x → 500 (1 ms)"],
  };
  if (kind === "multi") {
    const second = { ...e.targets[0]!, selector: "#two", source: "b.tsx:1:1", label: "Two", component: "A › Two" };
    e.targets = [e.targets[0]!, second];
  }
  const {
    id: _id,
    ref: _ref,
    n: _n,
    session: _s,
    status: _st,
    issue,
    created: _c,
    updated: _u,
    activity: _a,
    snapshot,
    ...rest
  } = e;
  void [_id, _ref, _n, _s, _st, _c, _u, _a];
  const p = poison({ ...rest, issue }) as NewEntry;
  p.targets = p.targets.map((t) => ({ ...t }));
  p.target = p.targets[0];
  return { ...p, ...(snapshot ? { snapshot } : {}) };
}

const leaksIn = (text: string) => LEAKS.filter((l) => text.includes(l));

describe.each(["element", "text", "multi"] as const)("no secret reaches a sink (%s entry)", (kind) => {
  it("is absent from the markdown, the IndexedDB record, the event and the store state", async () => {
    poisoned = 0;
    const draft = draftFor(kind);
    // The harness really did poison a lot of fields, and the input really is dirty.
    expect(poisoned).toBeGreaterThan(40);
    expect(leaksIn(JSON.stringify(draft)).length).toBeGreaterThan(3);

    const idb = createFakeIdb();
    const session = makeSession({ id: "2026-10-10_manual-test-pass" });
    const store = createStore({ session: { title: session.title, reviewer: session.reviewer, id: session.id, branch: "migrate/main", sha: "611df0b" }, idb: idb.factory });
    const events: unknown[] = [];
    store.on((e) => events.push(e));

    const entry = await store.create(draft);
    await store.flush();

    const md = serialize(entry, store.getState().session);
    expect(leaksIn(md), "markdown").toEqual([]);
    expect(leaksIn(JSON.stringify(idb.rows("proompter", "entries"))), "indexeddb entries").toEqual([]);
    expect(leaksIn(JSON.stringify(idb.rows("proompter", "sessions"))), "indexeddb sessions").toEqual([]);
    expect(leaksIn(JSON.stringify(events)), "entry:created event").toEqual([]);
    expect(leaksIn(JSON.stringify(store.getState())), "store state").toEqual([]);
    expect(leaksIn(JSON.stringify(entry)), "returned entry").toEqual([]);

    // And the file is still a valid entry after all that.
    expect(parse(md).id).toBe("PRO-1");
    expect(events).toHaveLength(1);
  });

  it("an update with secrets in it leaks nothing either", async () => {
    const idb = createFakeIdb();
    const store = createStore({ session: { title: "Manual test pass", reviewer: "rachit", id: "2026-10-10_manual-test-pass" }, idb: idb.factory });
    const events: unknown[] = [];
    store.on((e) => events.push(e));
    const e = await store.create(draftFor(kind));
    await store.update(e.id, { title: `t ${SECRET}`, description: `d ${SECRET}`, tags: [SECRET], testPlan: SECRET, task: SECRET, issue: SECRET });
    await store.flush();
    const all = JSON.stringify([events, idb.rows("proompter", "entries"), store.getState()]) + serialize(store.get(e.id)!);
    expect(leaksIn(all)).toEqual([]);
  });
});
