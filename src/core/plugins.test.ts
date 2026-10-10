import { describe, expect, it, vi } from "vitest";
import type { Entry, ProompterPlugin } from "./entry";
import { makeEntry, makeTarget } from "./entry-fixtures.test-util";
import { applyRedact, pluginContext, pluginTask, pluginTestPlan } from "./plugins";

const boom = () => {
  throw new Error("plugin bug");
};

describe("pluginTask", () => {
  it("first non-empty answer wins and gets the source and route", () => {
    const seen = vi.fn();
    const plugins: ProompterPlugin[] = [
      { name: "none", taskFor: () => null },
      {
        name: "tasks",
        taskFor: (t) => {
          seen(t);
          return "T-feed-home";
        },
      },
      { name: "later", taskFor: () => "T-other" },
    ];
    expect(pluginTask(plugins, { source: "a.tsx:1:1", route: "/feeds" })).toBe("T-feed-home");
    expect(seen).toHaveBeenCalledWith({ source: "a.tsx:1:1", route: "/feeds" });
  });

  it("skips plugins that throw or return junk; null when nobody knows", () => {
    const junk = { name: "junk", taskFor: () => 5 as unknown as string };
    expect(pluginTask([{ name: "x", taskFor: boom }, junk, { name: "empty", taskFor: () => "  " }], { route: "/" })).toBeNull();
    expect(pluginTask([{ name: "x", taskFor: boom }, { name: "ok", taskFor: () => "T-1" }], { route: "/" })).toBe("T-1");
    expect(pluginTask(undefined, { route: "/" })).toBeNull();
    expect(pluginTask([{ name: "no hook" }], { route: "/" })).toBeNull();
  });
});

describe("pluginContext", () => {
  it("merges extra fields in plugin order and ignores bad plugins", () => {
    const out = pluginContext([
      { name: "a", context: () => ({ owner: "dana", sprint: 1 }) },
      { name: "b", context: boom },
      { name: "c", context: () => ["not", "an", "object"] as unknown as Record<string, unknown> },
      { name: "d", context: () => ({ sprint: 2 }) },
    ]);
    expect(out).toEqual({ owner: "dana", sprint: 2 });
  });

  it("undefined when there is nothing", () => {
    expect(pluginContext(undefined)).toBeUndefined();
    expect(pluginContext([{ name: "a", context: () => ({}) }])).toBeUndefined();
  });
});

describe("pluginTestPlan", () => {
  it("collects sections, de-duplicated, in order", () => {
    expect(
      pluginTestPlan([
        { name: "a", testPlan: ["§2 Feed", "§5 Tournaments"] },
        { name: "b", testPlan: ["§5 Tournaments", "", "§7 Voice"] },
        { name: "c" },
        { name: "d", testPlan: "nope" as unknown as string[] },
      ]),
    ).toEqual(["§2 Feed", "§5 Tournaments", "§7 Voice"]);
    expect(pluginTestPlan(undefined)).toEqual([]);
  });
});

describe("applyRedact (fails closed)", () => {
  const strip: ProompterPlugin = {
    name: "strip",
    redact: (e) => ({ ...e, description: e.description.replace(/secret-\w+/g, "[redacted]"), context: { ...e.context, network: [] } }),
  };

  it("built-in redaction runs with no plugins at all, over title, description, quote and context", () => {
    const e = makeEntry({
      title: "mail a@b.com",
      description: "password=hunter2 and Bearer abc.def.ghi",
      quote: "token=zzz1234",
    });
    e.context.console = [{ ...e.context.console[0]!, message: "login failed for jo@example.com" }];
    e.context.network = [{ ...e.context.network[0]!, url: "/api?access_token=SECRET1&x=1", responseExcerpt: "password: hunter2" }];
    const r = applyRedact(undefined, e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dump = JSON.stringify(r.entry);
    for (const leak of ["a@b.com", "hunter2", "abc.def.ghi", "zzz1234", "jo@example.com", "SECRET1"]) expect(dump).not.toContain(leak);
    expect(r.entry.context.network[0]?.url).toContain("x=1");
    expect(e.description).toContain("hunter2"); // the input is untouched
  });

  it("built-in redaction also covers route, extra (recursively), tags, task, plan, issue, build and target text", () => {
    const target = makeTarget({ source: "src/a.tsx:1:1", component: "A › x@y.com", label: "x@y.com" });
    const e = makeEntry({
      route: "/a?token=abc&email=a@b.com",
      tags: ["bob@example.com"],
      task: "T-1 password=hunter2",
      testPlan: "plan for x@y.com",
      issue: "#1 jo@e.com",
      target,
      targets: [target],
      extra: {
        authToken: "Bearer abc.def",
        email: "bob@example.com",
        nested: { password: "x", note: "mail me@z.com" },
        list: ["a@b.com", { apiKey: "k" }],
        n: 5,
      },
    });
    e.context.build = "main@abc token=zzz9999";
    const r = applyRedact(undefined, e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.entry;
    const dump = JSON.stringify(out);
    for (const leak of ["token=abc", "a@b.com", "bob@example.com", "hunter2", "x@y.com", "jo@e.com", "abc.def", "me@z.com", "zzz9999", '"k"']) {
      expect(dump).not.toContain(leak);
    }
    expect(out.route).toMatch(/^\/a\?token=\[redacted\]/);
    expect(out.extra).toMatchObject({ authToken: "[redacted]", email: "[redacted]", nested: { password: "[redacted]" }, n: 5 });
    expect(out.target).toEqual(out.targets[0]);
    expect(out.target?.source).toBe("src/a.tsx:1:1");
    expect(e.extra?.email).toBe("bob@example.com"); // input untouched
  });

  it("built-in redaction runs BEFORE plugins: they only see redacted text", () => {
    const seen = vi.fn();
    const spy: ProompterPlugin = { name: "spy", redact: (x) => (seen(x.description), x) };
    applyRedact([spy], makeEntry({ description: "password=hunter2" }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).not.toContain("hunter2");
  });

  it("no redact hooks: the entry comes back unchanged", () => {
    const e = makeEntry();
    const r = applyRedact([{ name: "x" }], e);
    expect(r).toEqual({ ok: true, entry: e });
  });

  it("runs the plugins in order on a copy", () => {
    const e = makeEntry({ description: "token secret-abc here" });
    const second: ProompterPlugin = { name: "second", redact: (x) => ({ ...x, title: `${x.title}!` }) };
    const r = applyRedact([strip, second], e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.description).toBe("token [redacted] here");
    expect(r.entry.title).toBe("Avatar is cropped on mobile!");
    expect(r.entry.context.network).toEqual([]);
    expect(e.description).toBe("token secret-abc here"); // the original is untouched
    expect(e.context.network).toHaveLength(4);
  });

  it("a plugin that throws makes the whole thing fail: no entry comes out", () => {
    const e = makeEntry({ description: "token secret-abc" });
    const r = applyRedact([{ name: "broken", redact: boom }, strip], e);
    expect(r).toEqual({ ok: false, plugin: "broken", error: "plugin bug" });
  });

  it("a plugin that mutates its argument and then throws cannot change the caller's entry", () => {
    const e = makeEntry();
    const r = applyRedact(
      [
        {
          name: "mutator",
          redact: (x) => {
            x.description = "mutated";
            x.context.console.length = 0;
            throw new Error("late");
          },
        },
      ],
      e,
    );
    expect(r.ok).toBe(false);
    expect(e.description).toBe("Description as written.");
    expect(e.context.console).toHaveLength(2);
  });

  it("a plugin that returns the wrong thing is a failure, not a pass-through", () => {
    const e = makeEntry();
    const bad: Array<(x: Entry) => unknown> = [
      () => undefined,
      () => null,
      () => "entry",
      (x) => ({ ...x, id: "PRO-99" }),
      (x) => ({ ...x, session: "other" }),
      (x) => ({ ...x, n: 99 }),
      (x) => ({ ...x, tags: "ui" }),
      (x) => ({ ...x, context: undefined }),
      (x) => ({ ...x, context: { ...x.context, console: null } }),
    ];
    for (const f of bad) {
      const r = applyRedact([{ name: "bad", redact: f as (x: Entry) => Entry }], e);
      expect(r.ok).toBe(false);
    }
  });

  it("an unclonable entry fails closed too", () => {
    const e = makeEntry();
    (e.extra as unknown) = { fn: () => 1 };
    const r = applyRedact([strip], e);
    expect(r.ok).toBe(false);
  });
});
