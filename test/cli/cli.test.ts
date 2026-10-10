import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CliError, replyEntry, listEntries, listLine, resolveEntry, targetFor, taskText, testFile, findEntry } from "../../src/cli/core";
import { makeEntry, makeSession } from "../../src/core/entry-fixtures.test-util";
import { entryPath, parse, parseSession, serialize, serializeSession } from "../../src/core/serialize";

let root: string;
let t: ReturnType<typeof targetFor>;
const S1 = "2026-10-10_first-pass";
const S2 = "2026-10-11_second-pass";

function put(sessionId: string, over: Parameters<typeof makeEntry>[0]) {
  const session = makeSession({ id: sessionId });
  const entry = makeEntry({ session: sessionId, ...over });
  const dir = path.join(root, "reviews", sessionId);
  mkdirSync(path.join(dir, "entries"), { recursive: true });
  writeFileSync(path.join(dir, entryPath(entry)), serialize(entry, session));
  return { session, entry, dir };
}
function index(sessionId: string, ids: { id: string; n: number; title: string; status: "open" | "resolved"; priority: "minor" | "important" }[]) {
  writeFileSync(path.join(root, "reviews", sessionId, "session.md"), serializeSession(makeSession({ id: sessionId }), ids));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "proompter-cli-"));
  mkdirSync(path.join(root, ".git"));
  put(S1, { id: "PRO-1", n: 1, title: "Avatar cropped", priority: "important", route: "/feeds" });
  put(S1, { id: "PRO-2", n: 2, title: "Button low contrast", priority: "minor", route: "/settings", testPlan: "e2e/btn.spec.ts" });
  put(S2, { id: "PRO-1", n: 1, title: "Other thing", priority: "blocking", route: "/feeds/new" });
  index(S1, [
    { id: "PRO-1", n: 1, title: "Avatar cropped", status: "open", priority: "important" },
    { id: "PRO-2", n: 2, title: "Button low contrast", status: "open", priority: "minor" },
  ]);
  t = targetFor(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("cli core", () => {
  it("lists, filters and formats", async () => {
    expect(await listEntries(t)).toHaveLength(3);
    expect((await listEntries(t, { priority: "minor" })).map((r) => r.ref)).toEqual([`${S1}/PRO-2`]);
    expect((await listEntries(t, { route: "/feeds/*" })).map((r) => r.ref)).toEqual([`${S2}/PRO-1`]);
    expect(await listEntries(t, { session: "first-pass" })).toHaveLength(2);
    expect(await listEntries(t, { status: "resolved" })).toHaveLength(0);
    expect(listLine((await listEntries(t))[0]!)).toMatch(new RegExp(`^${S1}/PRO-1  open  important  Avatar cropped  \\S+:\\d+:\\d+$`));
  });

  it("resolves refs: qualified, unique, ambiguous, missing", async () => {
    expect((await findEntry(t, "PRO-2")).ref).toBe(`${S1}/PRO-2`);
    expect((await findEntry(t, `${S2}/PRO-1`)).entry.title).toBe("Other thing");
    await expect(findEntry(t, "PRO-1")).rejects.toMatchObject({ code: 2, message: expect.stringContaining(`${S2}/PRO-1`) });
    await expect(findEntry(t, "PRO-9")).rejects.toMatchObject({ code: 1 });
    await expect(findEntry(t, "nope")).rejects.toMatchObject({ code: 2 });
  });

  it("prints an agent task", async () => {
    const text = await taskText(t, "PRO-2");
    expect(text).toContain("# Button low contrast");
    expect(text).toContain(`proompter resolve ${S1}/PRO-2 --note`);
    expect(text).toContain("Make `e2e/btn.spec.ts` pass");
    expect(text).toContain("## Context");
  });

  it("detects test files in test_plan", () => {
    expect(testFile("e2e/a.spec.ts > case")).toBe("e2e/a.spec.ts");
    expect(testFile("§2 Feed and posts")).toBeNull();
    expect(testFile(undefined)).toBeNull();
  });

  it("resolves: status, note, session.md index", async () => {
    const r = await resolveEntry(t, `${S1}/PRO-1`, { note: "Fixed the crop." });
    expect(r.files).toEqual(["entries/001-avatar-cropped.md", "session.md"]);
    const dir = path.join(root, "reviews", S1);
    const e = parse(readFileSync(path.join(dir, "entries/001-avatar-cropped.md"), "utf8"));
    expect(e.status).toBe("resolved");
    expect(e.resolution).toBe("Fixed the crop.");
    const idx = parseSession(readFileSync(path.join(dir, "session.md"), "utf8")).entries;
    expect(idx.map((i) => i.status)).toEqual(["resolved", "open"]);
    // again: nothing to write
    expect((await resolveEntry(t, `${S1}/PRO-1`, { note: "Fixed the crop." })).files).toEqual([]);
  });

  it("--require-test: only a real test file inside the repo counts", async () => {
    const plan = (testPlan: string) => {
      put(S1, { id: "PRO-7", n: 7, title: "Plan test", testPlan });
    };
    writeFileSync(path.join(root, "README.md"), "");
    plan("README.md");
    await expect(resolveEntry(t, `${S1}/PRO-7`, { requireTest: true })).rejects.toMatchObject({ code: 2 });
    mkdirSync(path.join(root, "e2e/dir.spec.ts"), { recursive: true });
    plan("e2e/dir.spec.ts");
    await expect(resolveEntry(t, `${S1}/PRO-7`, { requireTest: true })).rejects.toMatchObject({ code: 2 });
    writeFileSync(path.join(root, "e2e/x.spec.ts"), "");
    plan("e2e/x.spec.ts");
    await expect(resolveEntry(t, `${S1}/PRO-7`, { requireTest: true })).resolves.toMatchObject({ ref: `${S1}/PRO-7` });
    symlinkSync(path.join(root, "README.md"), path.join(root, "e2e/link.spec.ts"));
    plan("e2e/link.spec.ts");
    await expect(resolveEntry(t, `${S1}/PRO-7`, { requireTest: true })).rejects.toMatchObject({ code: 2 });
  });

  it("rejects unknown --status and --priority values", async () => {
    await expect(listEntries(t, { status: "done" })).rejects.toMatchObject({ code: 2 });
    await expect(listEntries(t, { priority: "huge" })).rejects.toMatchObject({ code: 2 });
  });

  it("an ambiguous ref lists each ref once and counts the entries", async () => {
    await expect(findEntry(t, "PRO-1")).rejects.toMatchObject({ message: expect.stringContaining("2 entries share this id") });
  });

  it("task shows status, resolution and replies, and the closing instruction per client", async () => {
    await resolveEntry(t, `${S1}/PRO-1`, { note: "Cropped it." });
    await replyEntry(t, `${S1}/PRO-1`, "Thanks", "me");
    const cli = await taskText(t, `${S1}/PRO-1`);
    expect(cli).toContain("- Status: resolved");
    expect(cli).toContain("already resolved");
    expect(cli).toContain("## Resolution\nCropped it.");
    expect(cli).toMatch(/## Replies\n- me \(.*\): Thanks/);
    expect(cli).toContain("run `proompter resolve");
    expect(await taskText(t, `${S1}/PRO-1`, { closing: "mcp" })).toContain(`call resolve_entry with ref "${S1}/PRO-1"`);
  });

  it("--require-test refuses without an existing test file", async () => {
    await expect(resolveEntry(t, `${S1}/PRO-1`, { requireTest: true })).rejects.toBeInstanceOf(CliError);
    await expect(resolveEntry(t, `${S1}/PRO-2`, { requireTest: true })).rejects.toMatchObject({ code: 2, message: expect.stringContaining("not a test file") });
    mkdirSync(path.join(root, "e2e"));
    writeFileSync(path.join(root, "e2e/btn.spec.ts"), "");
    await expect(resolveEntry(t, `${S1}/PRO-2`, { requireTest: true })).resolves.toMatchObject({ ref: `${S1}/PRO-2` });
  });
});

describe("cli bin (built)", () => {
  const bin = path.resolve(__dirname, "../../dist/cli/index.js");
  beforeAll(() => {
    if (!existsSync(bin)) throw new Error(`${bin} is missing: run pnpm build first`);
  });
  const run = (...args: string[]) => spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });

  it("list --dir works end to end, with exit codes", () => {
    const out = execFileSync("node", [bin, "list", "--dir", path.join(root, "reviews"), "--status", "open"], { cwd: root, encoding: "utf8" });
    expect(out.trim().split("\n")).toHaveLength(3);
    expect(run("show", "PRO-9").status).toBe(1);
    expect(run("show", "PRO-1").status).toBe(2);
    expect(run("bogus").status).toBe(2);
    expect(run("list", "--dir", path.join(root, "nope")).status).toBe(2);
    expect(run("list", "--dir", path.join(root, "nope")).stderr).toContain("does not exist");
    expect(run("list", "--status", "done").status).toBe(2);
    expect(run("list", "--nope").status).toBe(2);
    expect(run("--help").stdout).toContain("Usage:");
    expect(JSON.parse(run("list", "--json").stdout)).toHaveLength(3);
    expect(run("resolve", `${S1}/PRO-1`, "--note", "ok").stdout).toBe(`resolved ${S1}/PRO-1\n`);
  });
});
