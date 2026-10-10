import { describe, expect, it } from "vitest";
import type { Entry, EntryTarget } from "./entry";
import { makeEntry, makeSession, makeTarget, CONSOLE, NETWORK, SOURCE } from "./entry-fixtures.test-util";
import {
  assetNames,
  cleanDescription,
  deriveRotated,
  entryFileName,
  entryPath,
  fileProjection,
  isoSeconds,
  pad,
  parse,
  ParseError,
  parseSession,
  serialize,
  serializeSession,
  sessionIdFor,
  slugify,
  summarizeContext,
} from "./serialize";

/** serialize, parse, and check the result is exactly the file-carried projection. */
function roundTrip(e: Entry, session?: ReturnType<typeof makeSession>) {
  const md = serialize(e, session);
  const back = parse(md);
  expect(back).toEqual(fileProjection(e, session));
  return { md, back };
}

const lines = (md: string) => md.split("\n");

describe("serialize: the DESIGN §8 example", () => {
  it("writes the file exactly", () => {
    expect(serialize(makeEntry())).toBe(`---
id: PRO-5
ref: 2026-10-10_manual-test-pass/PRO-5
session: 2026-10-10_manual-test-pass
status: open
intent: fix
priority: important
kind: element
viewport: mobile 390x844
route: /feeds
source: src/app/(app)/feeds/_components/post-card.tsx:48:7
source_inherited: true
selector: '[data-src="src/app/(app)/feeds/_components/post-card.tsx:48:7"] > div:nth-of-type(1) > div:nth-of-type(1)'
component: FeedPage › FeedList › PostCard › PostHeader › Avatar
task: T-feed-home
test_plan: §2 Feed and posts
tags: [ui]
issue: null
created: 2026-10-10T12:42:07Z
---

# Avatar is cropped on mobile

Description as written.

## Context
- Console: 2 lines, 1 error
  - error GET /api/v1/feeds/trending 500
  - warn [voice] AudioContext suspended until a user gesture
- Network: 1 failed of 4
  - GET /api/v1/feeds/trending → 500 (911 ms)
- Build: migrate/main@611df0b

![mobile](../assets/005-mobile.png)
`);
  });

  it("frontmatter fields come in the documented order", () => {
    const keys = lines(serialize(makeEntry()))
      .slice(1, lines(serialize(makeEntry())).indexOf("---", 1))
      .map((l) => l.split(":")[0]);
    expect(keys).toEqual([
      "id",
      "ref",
      "session",
      "status",
      "intent",
      "priority",
      "kind",
      "viewport",
      "route",
      "source",
      "source_inherited",
      "selector",
      "component",
      "task",
      "test_plan",
      "tags",
      "issue",
      "created",
    ]);
  });

  it("always writes kind and the fully qualified ref; a file without kind or ref still parses", () => {
    const md = serialize(makeEntry({ kind: "note", target: undefined, targets: [] }));
    expect(md).toContain("\nkind: note\n");
    expect(md).toContain("\nref: 2026-10-10_manual-test-pass/PRO-5\n");
    const old = serialize(makeEntry()).replace(/^kind: .*\n/m, "").replace(/^ref: .*\n/m, "");
    const back = parse(old);
    expect(back.kind).toBe("element");
    expect(back.ref).toBe("2026-10-10_manual-test-pass/PRO-5");
  });

  it("omits task and test_plan when absent, and still round-trips", () => {
    const e = makeEntry();
    delete e.task;
    delete e.testPlan;
    const { md } = roundTrip(e);
    expect(md).not.toMatch(/^task:/m);
    expect(md).not.toMatch(/^test_plan:/m);
  });

  it("every file-carried field survives, checked one by one", () => {
    const e = makeEntry({
      status: "progress",
      intent: "change",
      priority: "blocking",
      viewport: "tablet",
      size: { width: 1194, height: 834 },
      rotated: true,
      route: "/tournaments/vnc-2291?tab=standings#row-2",
      issue: "#481",
      tags: ["ui", "data", "needs review"],
      created: "2026-10-10T12:42:07.123Z",
      extra: { sprint: 12, flag: true, owner: "dana", labels: ["a", "b"], nothing: null },
    });
    const { back } = roundTrip(e);
    expect(back.id).toBe("PRO-5");
    expect(back.n).toBe(5);
    expect(back.session).toBe(e.session);
    expect(back.status).toBe("progress");
    expect(back.intent).toBe("change");
    expect(back.priority).toBe("blocking");
    expect(back.kind).toBe("element");
    expect(back.title).toBe(e.title);
    expect(back.description).toBe(e.description);
    expect(back.viewport).toBe("tablet");
    expect(back.size).toEqual({ width: 1194, height: 834 });
    expect(back.rotated).toBe(true);
    expect(back.route).toBe(e.route);
    expect(back.target).toEqual(e.target);
    expect(back.targets).toEqual(e.targets);
    expect(back.task).toBe("T-feed-home");
    expect(back.testPlan).toBe("§2 Feed and posts");
    expect(back.tags).toEqual(["ui", "data", "needs review"]);
    expect(back.issue).toBe("#481");
    expect(back.created).toBe("2026-10-10T12:42:07Z"); // milliseconds are not in the file
    expect(back.updated).toBe(back.created);
    expect(back.extra).toEqual({ sprint: 12, flag: true, owner: "dana", labels: ["a", "b"], nothing: null });
    expect(back.context.build).toBe("migrate/main@611df0b");
  });

  it("derives rotated from the size", () => {
    expect(deriveRotated("mobile", { width: 390, height: 844 })).toBe(false);
    expect(deriveRotated("mobile", { width: 844, height: 390 })).toBe(true);
    expect(deriveRotated("desktop", { width: 900, height: 1440 })).toBe(true);
    expect(deriveRotated("desktop", { width: 1440, height: 900 })).toBe(false);
    expect(deriveRotated("responsive", { width: 900, height: 1440 })).toBe(false);
    expect(serialize(makeEntry({ viewport: "mobile", size: { width: 844, height: 390 }, rotated: true }))).toContain("viewport: mobile 844x390");
  });

  it("writes responsive with the window size", () => {
    const { md, back } = roundTrip(makeEntry({ viewport: "responsive", size: { width: 1280, height: 800 } }));
    expect(md).toContain("viewport: responsive 1280x800");
    expect(md).toContain("![responsive](../assets/005-responsive.png)");
    expect(back.rotated).toBe(false);
  });
});

describe("serialize: kinds", () => {
  const t2: EntryTarget = makeTarget({
    selector: '[data-src="x/y.tsx:3:1"]',
    source: "x/y.tsx:3:1",
    sourceInherited: false,
    label: "button “Share”",
    component: "PostCard › button “Share”",
  });
  const t3: EntryTarget = { selector: "body > div:nth-of-type(2)", source: null, sourceInherited: false, label: "div", component: "div" };

  it("element, own source", () => {
    const e = makeEntry({ target: t2, targets: [t2] });
    const { md, back } = roundTrip(e);
    expect(md).toContain("source_inherited: false");
    expect(back.kind).toBe("element");
    expect(back.target?.label).toBe("button “Share”");
  });

  it("element, inherited source", () => {
    const { md } = roundTrip(makeEntry());
    expect(md).toContain("source_inherited: true");
  });

  it("element, no source anywhere: source is null, not invented", () => {
    const e = makeEntry({ target: t3, targets: [t3], task: undefined });
    const { md, back } = roundTrip(e);
    expect(md).toContain("\nsource: null\n");
    expect(back.target?.source).toBeNull();
  });

  it("multi: kind, first-target frontmatter, and a Targets section", () => {
    const e = makeEntry({ kind: "multi", target: makeTarget(), targets: [makeTarget(), t2, t3] });
    const { md, back } = roundTrip(e);
    expect(md).toContain("\nkind: multi\n");
    expect(md).toContain("## Targets\n\n### 1. Avatar\n- source: src/app/(app)/feeds/_components/post-card.tsx:48:7\n- inherited: true\n- selector: '[data-src=");
    expect(md).toContain("### 2. button “Share”");
    expect(md).toContain("### 3. div\n- source: null\n- inherited: false");
    expect(back.targets).toHaveLength(3);
    expect(back.targets[1]).toEqual(t2);
    expect(back.targets[2]).toEqual(t3);
    expect(back.target).toEqual(back.targets[0]);
  });

  it("box", () => {
    const e = makeEntry({ kind: "box", target: t2, targets: [t2, t3] });
    const { md, back } = roundTrip(e);
    expect(md).toContain("\nkind: box\n");
    expect(back.kind).toBe("box");
    expect(back.targets).toEqual([t2, t3]);
  });

  it("box that enclosed nothing", () => {
    const e = makeEntry({ kind: "box", target: undefined, targets: [] });
    const { md, back } = roundTrip(e);
    expect(md).not.toContain("## Targets");
    expect(md).not.toMatch(/^selector:/m);
    expect(back.targets).toEqual([]);
    expect(back.target).toBeUndefined();
  });

  it("text: the quote is a block under the title", () => {
    const e = makeEntry({ kind: "text", quote: "Clutched a 1v4\nin the final round" });
    const { md, back } = roundTrip(e);
    expect(md).toContain("\nkind: text\n");
    expect(md).toContain("# Avatar is cropped on mobile\n\n> Clutched a 1v4\n> in the final round\n\nDescription as written.");
    expect(back.quote).toBe("Clutched a 1v4\nin the final round");
    expect(back.description).toBe("Description as written.");
  });

  it("text with blank lines and indentation in the quote, and an empty one", () => {
    roundTrip(makeEntry({ kind: "text", quote: "one\n\n  two\n" }));
    const { back } = roundTrip(makeEntry({ kind: "text", quote: "", description: "> looks like a quote" }));
    expect(back.quote).toBe("");
    expect(back.description).toBe("> looks like a quote");
  });

  it("text with no element under the selection", () => {
    const e = makeEntry({ kind: "text", quote: "hello", target: undefined, targets: [] });
    const { md, back } = roundTrip(e);
    expect(md).not.toMatch(/^selector:/m);
    expect(back.target).toBeUndefined();
    expect(back.kind).toBe("text");
  });

  it("page note: no target, no snapshot link needed", () => {
    const e = makeEntry({ kind: "note", target: undefined, targets: [], snapshot: undefined, task: undefined });
    const { md, back } = roundTrip(e);
    expect(md).toContain("source: null\nsource_inherited: false\n");
    expect(md).not.toMatch(/^selector:/m);
    expect(md).not.toContain("![");
    expect(back.kind).toBe("note");
    expect(back.targets).toEqual([]);
    expect(back.snapshot).toBeUndefined();
  });

  it("no snapshot link when no snapshot was taken; a link when only the file name is known", () => {
    expect(serialize(makeEntry({ snapshot: undefined }))).not.toContain("![");
    expect(serialize(makeEntry({ snapshot: { fontsEmbedded: false } }))).not.toContain("![");
    const e = makeEntry({ snapshot: { assets: { element: "005-mobile.png" } } });
    const { md, back } = roundTrip(e);
    expect(md).toContain("![mobile](../assets/005-mobile.png)");
    expect(back.snapshot).toEqual({ assets: { element: "005-mobile.png" } });
  });
});

describe("serialize: context", () => {
  it("writes counts and one-line items, with plurals", () => {
    const e = makeEntry();
    e.context.console = [CONSOLE[0]!];
    const md = serialize(e);
    expect(md).toContain("- Console: 1 line, 1 error\n  - error GET /api/v1/feeds/trending 500\n");
    e.context.console = [CONSOLE[1]!, { ...CONSOLE[1]!, message: "second" }];
    expect(serialize(e)).toContain("- Console: 2 lines, 0 errors\n");
  });

  it("lists only failed requests, and failed-before-response ones say so", () => {
    const e = makeEntry();
    e.context.network = [
      ...NETWORK,
      { ...NETWORK[0]!, method: "POST", url: "/api/x", status: null, ok: false, durationMs: 30.4, error: "Failed to fetch" },
    ];
    const md = serialize(e);
    expect(md).toContain("- Network: 2 failed of 5\n");
    expect(md).toContain("  - GET /api/v1/feeds/trending → 500 (911 ms)\n");
    expect(md).toContain("  - POST /api/x → failed (30 ms)\n");
  });

  it("an empty context still writes the section", () => {
    const e = makeEntry({ context: { console: [], network: [], queries: [] } });
    const md = serialize(e);
    expect(md).toContain("## Context\n- Console: 0 lines, 0 errors\n- Network: 0 failed of 0\n");
    expect(md).not.toContain("- Build:");
    roundTrip(e);
  });

  it("keeps messages on one line and clips very long ones", () => {
    const e = makeEntry();
    e.context.console = [{ ...CONSOLE[0]!, message: `line one\nline two\n- Network: 5 failed of 9\n${"x".repeat(500)}` }];
    const md = serialize(e);
    const item = lines(md).find((l) => l.startsWith("  - error line one"))!;
    expect(item).toContain("line one line two - Network: 5 failed of 9");
    expect(item.length).toBeLessThan(215);
    const back = roundTrip(e).back;
    expect(back.context.summary?.networkFailed).toBe(1); // the injected text did not become a bullet
  });

  it("the build comes from the session when the entry has none", () => {
    const e = makeEntry();
    delete e.context.build;
    expect(serialize(e)).not.toContain("- Build:");
    const s = makeSession();
    expect(serialize(e, s)).toContain("- Build: migrate/main@611df0b\n");
    roundTrip(e, s);
  });

  it("a parsed entry serialises to the same file (summary in, summary out)", () => {
    const md = serialize(makeEntry());
    expect(serialize(parse(md))).toBe(md);
  });

  it("summarizeContext on a parsed context returns the summary it carries", () => {
    const parsed = parse(serialize(makeEntry()));
    expect(summarizeContext(parsed.context)).toEqual(parsed.context.summary);
    expect(parsed.context.summary).toEqual({
      consoleLines: 2,
      consoleErrors: 1,
      consoleItems: ["error GET /api/v1/feeds/trending 500", "warn [voice] AudioContext suspended until a user gesture"],
      networkTotal: 4,
      networkFailed: 1,
      networkItems: ["GET /api/v1/feeds/trending → 500 (911 ms)"],
    });
    expect(parsed.context.console).toEqual([]);
  });
});

describe("serialize: escaping and hostile text", () => {
  it("titles with colons, quotes, #, leading dashes, emoji and line breaks", () => {
    for (const title of [
      "Fix: the avatar",
      'He said "hi" and it\'s broken',
      "# not a heading",
      "- starts with a dash",
      "Résumé 🎯 日本語",
      "line one\nline two",
      "trailing  ",
      "[x](y) *z* `code`",
    ]) {
      const e = makeEntry({ title });
      const { md, back } = roundTrip(e);
      expect(back.title).toBe(title.replace(/\s*\n\s*/g, " ").trim());
      // The title can never leak into the frontmatter.
      expect(lines(md)[lines(md).indexOf("---", 1) + 2]).toMatch(/^# /);
    }
  });

  it("values that need YAML quoting round-trip", () => {
    const e = makeEntry({
      route: "/feeds?a=b&c=d#frag: x",
      task: "T-1: a #b",
      testPlan: "null",
      issue: "#481",
      tags: ["a,b", "c: d", "[e]", "'f'", '"g"', "true", "12", "# h", " i ", "ü"],
      session: "2026-10-10_it's: ok",
      target: makeTarget({
        selector: `[data-src="a'b"] > p:nth-of-type(2)`,
        source: "src/it's: here #1.tsx:3:4",
        component: 'A › "B" › C: D #E',
      }),
    });
    e.targets = [e.target!];
    const { md } = roundTrip(e);
    expect(md).toContain(`selector: '[data-src="a''b"] > p:nth-of-type(2)'`);
    expect(md).toContain("issue: '#481'");
    expect(md).toContain("test_plan: 'null'");
  });

  it("strings with line breaks and control characters in frontmatter fields", () => {
    const e = makeEntry({ route: "/a\nb", testPlan: "x\ty\u0001", task: "T\r\nU" });
    const { back } = roundTrip(e);
    expect(back.route).toBe("/a\nb");
    expect(back.testPlan).toBe("x\ty\u0001");
    expect(back.task).toBe("T\r\nU");
  });

  it("a description that looks like file structure is not mistaken for it", () => {
    const description = [
      "Intro",
      "",
      "## Context",
      "- Console: 9 lines, 9 errors",
      "  - error fake",
      "",
      "## Targets",
      "",
      "### 1. fake",
      "- source: nope",
      "",
      "---",
      "id: PRO-999",
      "---",
      "> quote-looking",
      "# Another title",
      "```",
      "![x](../assets/zzz.png)",
    ].join("\n");
    for (const kind of ["element", "text", "multi", "box", "note"] as const) {
      const t2 = makeTarget({ label: "Two", component: "A › Two", source: "b.tsx:1:1", sourceInherited: false, selector: "#two" });
      const base = makeEntry({
        kind,
        description,
        ...(kind === "text" ? { quote: "q" } : {}),
        ...(kind === "multi" || kind === "box" ? { targets: [makeTarget(), t2], target: makeTarget() } : {}),
        ...(kind === "note" ? { target: undefined, targets: [] } : {}),
      });
      const { back } = roundTrip(base);
      expect(back.description).toBe(description);
      expect(back.id).toBe("PRO-5");
      expect(back.context.summary?.consoleLines).toBe(2);
      expect(back.snapshot?.assets?.element).toBe("005-mobile.png");
      if (kind === "multi" || kind === "box") expect(back.targets.map((t) => t.label)).toEqual(["Avatar", "Two"]);
    }
  });

  it("keeps description indentation, CRLF becomes LF, blank edge lines are dropped", () => {
    const { back } = roundTrip(makeEntry({ description: "\n\n    indented code\r\nsecond\r\n\n" }));
    expect(back.description).toBe("    indented code\nsecond");
    expect(roundTrip(makeEntry({ description: "" })).back.description).toBe("");
    expect(roundTrip(makeEntry({ description: "   \n  " })).back.description).toBe("");
  });

  it("an empty title is allowed in the file (the composer is what requires one)", () => {
    expect(roundTrip(makeEntry({ title: "" })).back.title).toBe("");
  });

  it("extra: only safe keys, scalars typed, nested values become strings, collisions dropped", () => {
    const e = makeEntry({
      extra: {
        sprint: 12,
        ratio: 0.5,
        on: true,
        off: false,
        none: null,
        text: "5",
        word: "true",
        list: ["a", "b"],
        nested: { a: 1 },
        id: "PRO-999",
        ref: "x/PRO-1",
        kind: "multi",
        "bad key": 1,
        "9bad": 1,
        proompter: 2,
        big: Number.NaN,
      },
    });
    const md = serialize(e);
    expect(md).toContain("\nsprint: 12\n");
    expect(md).toContain("\ntext: '5'\n");
    expect(md).toContain("\nword: 'true'\n");
    expect(md).toContain('\nnested: \'{"a":1}\'\n');
    expect(md).not.toContain("PRO-999");
    expect(md).not.toContain("bad key");
    expect(md).not.toContain("9bad");
    expect(md).not.toMatch(/^proompter:/m);
    const back = parse(md);
    expect(back.id).toBe("PRO-5");
    expect(back.kind).toBe("element");
    expect(back.extra).toEqual({
      sprint: 12,
      ratio: 0.5,
      on: true,
      off: false,
      none: null,
      text: "5",
      word: "true",
      list: ["a", "b"],
      nested: '{"a":1}',
      big: "NaN",
    });
    expect(back).toEqual(fileProjection(e));
  });
});

describe("hostile keys and indentation", () => {
  it("ignores __proto__, constructor and prototype in a file, and never writes them", () => {
    const md = serialize(makeEntry()).replace(
      "created: 2026-10-10T12:42:07Z\n",
      "created: 2026-10-10T12:42:07Z\n__proto__: x\nconstructor: 1\nprototype: 2\nowner: dana\n",
    );
    const back = parse(md);
    expect(back.extra).toEqual({ owner: "dana" });
    expect(Object.keys(back.extra ?? {})).toEqual(["owner"]);
    expect(({} as Record<string, unknown>).owner).toBeUndefined();
    const hostile = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","a":1}') as Record<string, unknown>;
    const out = serialize(makeEntry({ extra: hostile }));
    expect(out).not.toMatch(/__proto__|^constructor:|^prototype:/m);
    expect(parse(out).extra).toEqual({ a: 1 });
  });

  it("keeps a description's leading indentation, drops trailing whitespace and leading blank lines", () => {
    const { back } = roundTrip(makeEntry({ description: "\n\n    code\n  more   \n\n" }));
    expect(back.description).toBe("    code\n  more");
    expect(cleanDescription("  x  \r\n")).toBe("  x");
  });
});

describe("parse", () => {
  const good = serialize(makeEntry());

  it("reads a hand-edited file: CRLF, comments, other quoting, extra blank lines", () => {
    const edited = good
      .replace("status: open", "status: open            # open | progress | resolved")
      .replace("priority: important", 'priority: "important"')
      .replace(/\n/g, "\r\n");
    expect(parse(edited)).toEqual(parse(good));
  });

  it("rejects things that are not entries, with a ParseError", () => {
    expect(() => parse("")).toThrow(ParseError);
    expect(() => parse("# just markdown")).toThrow(ParseError);
    expect(() => parse(good.replace(/^id: .*\n/m, ""))).toThrow(/missing 'id'/);
    expect(() => parse(good.replace("id: PRO-5", "id: ticket-5"))).toThrow(/PRO-12/);
    expect(() => parse(good.replace("status: open", "status: done"))).toThrow(/unknown status/);
    expect(() => parse(good.replace("intent: fix", "intent: wat"))).toThrow(/unknown intent/);
    expect(() => parse(good.replace("priority: important", "priority: urgent"))).toThrow(/unknown priority/);
    expect(() => parse(good.replace("mobile 390x844", "phone 390x844"))).toThrow(/unknown viewport/);
    expect(() => parse(good.replace("mobile 390x844", "mobile big"))).toThrow(/viewport/);
    expect(() => parse(good.replace("created: 2026-10-10T12:42:07Z\n", ""))).toThrow(/missing 'created'/);
    expect(() => parse(good.replace("# Avatar is cropped on mobile", "Avatar is cropped on mobile"))).toThrow(/Title/);
    expect(() => parse(good.replace("source_inherited: true", "source_inherited: maybe"))).toThrow(ParseError);
    expect(() => parse(good.replace("tags: [ui]", "tags: [ui"))).toThrow(ParseError);
  });

  it("is lenient about optional parts", () => {
    const min = parse("---\nid: PRO-1\nsession: s\nstatus: open\nintent: fix\npriority: minor\nviewport: responsive 800x600\ncreated: 2026-01-01T00:00:00Z\n---\n\n# T\n");
    expect(min.kind).toBe("note");
    expect(min.route).toBe("");
    expect(min.tags).toEqual([]);
    expect(min.issue).toBeNull();
    expect(min.description).toBe("");
    expect(min.context.summary?.consoleLines).toBe(0);
  });
});

describe("session.md", () => {
  const entries = [
    makeEntry({ id: "PRO-2", n: 2, title: "Second [wip] (see #3)", status: "progress", priority: "minor" }),
    makeEntry({ id: "PRO-1", n: 1, title: "First", status: "resolved", priority: "blocking" }),
  ];

  it("writes proompter: 1, the session fields and the entry index", () => {
    expect(serializeSession(makeSession(), entries)).toBe(`---
proompter: 1
session: 2026-10-10_manual-test-pass
title: Manual test pass
reviewer: rachit
branch: migrate/main
sha: 611df0b
env: local · prod data (redacted)
started: 2026-10-10T12:40:00Z
---

# Manual test pass

## Entries

- PRO-1 · resolved · blocking · [First](entries/001-first.md)
- PRO-2 · progress · minor · [Second [wip] (see #3)](entries/002-second-wip-see-3.md)
`);
  });

  it("round-trips, optional fields included or not", () => {
    const s = makeSession();
    const back = parseSession(serializeSession(s, entries));
    expect(back.session).toEqual(s);
    expect(back.entries).toEqual([
      { id: "PRO-1", n: 1, status: "resolved", priority: "blocking", title: "First", file: "entries/001-first.md" },
      { id: "PRO-2", n: 2, status: "progress", priority: "minor", title: "Second [wip] (see #3)", file: "entries/002-second-wip-see-3.md" },
    ]);
    const bare = { id: "2026-10-10_x", title: "X: a #b", reviewer: "r", started: "2026-10-10T12:40:00Z", version: 1 as const };
    expect(parseSession(serializeSession(bare, [])).session).toEqual(bare);
    expect(serializeSession(bare, [])).toContain("No entries yet.");
  });

  it("the index points at the files the entry paths name", () => {
    const e = makeEntry({ n: 12, id: "PRO-12", title: "Avatar is cropped on mobile" });
    expect(serializeSession(makeSession(), [e])).toContain(`(${entryPath(e)})`);
  });

  it("refuses other format versions and non-session files", () => {
    const md = serializeSession(makeSession(), []);
    expect(() => parseSession(md.replace("proompter: 1", "proompter: 2"))).toThrow(/unsupported session format/);
    expect(() => parseSession(md.replace("proompter: 1\n", ""))).toThrow(ParseError);
    expect(() => parseSession(serialize(makeEntry()))).toThrow(ParseError);
    expect(() => parseSession(md.replace(/^title: .*\n/m, ""))).toThrow(/missing 'title'/);
  });
});

describe("names", () => {
  it("pad", () => {
    expect(pad(5)).toBe("005");
    expect(pad(1234)).toBe("1234");
  });

  it("slugify", () => {
    expect(slugify("Avatar is cropped on mobile")).toBe("avatar-is-cropped-on-mobile");
    expect(slugify("  Café über — 100% “done”!  ")).toBe("cafe-uber-100-done");
    expect(slugify("!!!")).toBe("note");
    expect(slugify("")).toBe("note");
    expect(slugify("日本語")).toBe("note");
    const long = slugify("word ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(42);
    expect(long.endsWith("-")).toBe(false);
  });

  it("entry file names and asset names", () => {
    expect(entryFileName({ n: 5, title: "Avatar is cropped on mobile" })).toBe("005-avatar-is-cropped-on-mobile.md");
    expect(entryPath({ n: 5, title: "Avatar is cropped on mobile" })).toBe("entries/005-avatar-is-cropped-on-mobile.md");
    expect(assetNames(5, "mobile")).toEqual({ element: "005-mobile.png", viewport: "005-mobile-full.png" });
  });

  it("session ids and timestamps", () => {
    expect(sessionIdFor("Manual test pass", new Date(2026, 9, 10, 12, 0))).toBe("2026-10-10_manual-test-pass");
    expect(isoSeconds("2026-10-10T12:42:07.123Z")).toBe("2026-10-10T12:42:07Z");
    expect(isoSeconds("2026-10-10T12:42:07Z")).toBe("2026-10-10T12:42:07Z");
    expect(isoSeconds("2026-10-10T12:42:07.5+02:00")).toBe("2026-10-10T12:42:07+02:00");
    expect(isoSeconds(new Date(Date.UTC(2026, 9, 10, 12, 42, 7, 999)))).toBe("2026-10-10T12:42:07Z");
  });

  it("the selector helper constants are what the tests assume", () => {
    expect(makeTarget().source).toBe(SOURCE);
  });
});

describe("kind is escaped like every other frontmatter value (T09)", () => {
  it("a kind with a line break cannot inject another frontmatter key", () => {
    const md = serialize({ ...makeEntry(), kind: "point\nstatus: resolved" as Entry["kind"] });
    const fm = md.split("\n---\n")[0] ?? "";
    expect(fm.split("\n").filter((l) => l.startsWith("status:"))).toEqual(["status: open"]);
    expect(fm).toMatch(/^kind: "point\\nstatus: resolved"$/m);
  });

  it("plain kinds are still written bare", () => {
    expect(serialize(makeEntry())).toMatch(/^kind: element$/m);
  });
});

describe("serialize: resolution (T15)", () => {
  it("round-trips a ## Resolution section before ## Context", () => {
    const { md, back } = roundTrip(makeEntry({ status: "resolved", resolution: "Cropped the avatar.\n\nSee commit abc." }));
    expect(back.resolution).toBe("Cropped the avatar.\n\nSee commit abc.");
    expect(md.indexOf("## Resolution")).toBeLessThan(md.indexOf("## Context"));
  });

  it("is omitted when blank, and works for multi entries and an image link", () => {
    expect(serialize(makeEntry({ resolution: "  \n" }))).not.toContain("## Resolution");
    const multi = makeEntry({ kind: "multi", targets: [makeTarget(), makeTarget({ label: "Second" })], resolution: "done" });
    const { back } = roundTrip(multi);
    expect(back.resolution).toBe("done");
    expect(back.targets).toHaveLength(2);
    expect(back.description).not.toContain("Resolution");
  });
});
