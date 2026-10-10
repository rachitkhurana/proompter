import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeEntry, makeSession } from "../../src/core/entry-fixtures.test-util";
import { entryPath, parse, serialize } from "../../src/core/serialize";
import { replyLine } from "../../src/cli/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;
let root: string;
const S1 = "2026-10-10_first-pass";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "proompter-mcp-"));
  mkdirSync(path.join(root, ".git"));
  const entry = makeEntry({ session: S1, id: "PRO-1", n: 1, title: "Avatar cropped", priority: "important" });
  const dir = path.join(root, "reviews", S1);
  mkdirSync(path.join(dir, "entries"), { recursive: true });
  writeFileSync(path.join(dir, entryPath(entry)), serialize(entry, makeSession({ id: S1 })));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const bin = path.resolve(__dirname, "../../dist/cli/index.js");
beforeAll(() => {
  if (!existsSync(bin)) throw new Error(`${bin} is missing: run pnpm build first`);
});
const file = () => path.join(root, "reviews", S1, "entries", "001-avatar-cropped.md");

/** Spawn the server, send every line, close stdin and collect stdout lines and the exit code. */
function session(lines: string[], args: string[] = ["--dir", path.join(root, "reviews")]) {
  return new Promise<{ out: Msg[]; raw: string; code: number | null; err: string }>((resolve, reject) => {
    const p = spawn("node", [bin, "mcp", ...args], { cwd: root });
    let raw = "";
    let err = "";
    p.stdout.on("data", (d) => (raw += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ out: raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)), raw, code, err }));
    p.stdin.end(`${lines.join("\n")}\n`);
  });
}
const req = (id: number, method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const call = (id: number, name: string, args: unknown) => req(id, "tools/call", { name, arguments: args });

describe("proompter mcp (built bin)", () => {
  it("initialize, tools/list, every tool, a bad line and an unknown method", async () => {
    const r = await session([
      req(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      req(2, "ping"),
      req(3, "tools/list"),
      call(4, "list_entries", { status: "open" }),
      call(5, "show_entry", { ref: "PRO-1" }),
      call(6, "entry_task", { ref: "PRO-1" }),
      call(7, "reply_entry", { ref: "PRO-1", text: "Looking\ninto it", who: "claude" }),
      call(8, "resolve_entry", { ref: `${S1}/PRO-1`, note: "Cropped it." }),
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "resolve_entry", arguments: { ref: "PRO-1" } } }), // a notification: not run
      JSON.stringify({ jsonrpc: "2.0", method: "bogus/notification" }),
      "[]",
      "{not json",
      req(9, "bogus/method"),
      call(10, "show_entry", { ref: "PRO-9" }),
      call(11, "show_entry", {}),
      call(12, "nope", {}),
      call(13, "resolve_entry", { ref: "PRO-1", requireTest: true }),
    ]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    const by = (id: number | null): Msg => r.out.find((m) => m.id === id) ?? {};
    expect(r.out.every((m) => m.jsonrpc === "2.0")).toBe(true);

    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { version: string };
    expect(by(1).result).toEqual({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "proompter", version: pkg.version } });
    expect(by(2).result).toEqual({});
    expect(r.out).toHaveLength(15); // no answer to the three notifications

    const tools = by(3).result.tools;
    expect(tools.map((x: { name: string; inputSchema: { type: string } }) => x.name)).toEqual(["list_entries", "show_entry", "entry_task", "reply_entry", "resolve_entry"]);
    for (const x of tools) expect(x.inputSchema.type).toBe("object");

    expect(JSON.parse(by(4).result.content[0].text)).toHaveLength(1);
    expect(by(5).result.content[0].text).toContain("# Avatar cropped");
    expect(by(6).result.content[0].text).toContain("resolve_entry");
    expect(by(7).result.isError).toBeUndefined();
    expect(by(6).result.content[0].text).toContain('call resolve_entry with ref');
    expect(by(8).result.content[0].text).toBe(`resolved ${S1}/PRO-1`);

    const e = parse(readFileSync(file(), "utf8"));
    expect(e.status).toBe("resolved");
    expect(e.resolution).toBe("Cropped it.");
    expect(e.replies).toMatch(/^- claude \(\d{4}-\d\d-\d\dT[\d:]+Z\): Looking into it$/);

    expect(r.out.find((m) => m.error?.code === -32700)?.id).toBeNull();
    expect(by(9).error.code).toBe(-32601);
    expect(by(10).result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("no entry") }] });
    expect(by(11).result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("'ref' is required") }] });
    expect(r.out.find((m) => m.error?.code === -32600)?.id).toBeNull(); // a batch array is not a request
    expect(by(12).error.code).toBe(-32602);
    expect(by(13).result.isError).toBe(true);
  });

  it("answers an unknown protocolVersion with 2025-06-18, and appends replies in order", async () => {
    const r = await session([req(1, "initialize", { protocolVersion: "1999-01-01" }), call(2, "reply_entry", { ref: "PRO-1", text: "one" }), call(3, "reply_entry", { ref: "PRO-1", text: "two" })]);
    expect(r.out[0]?.result.protocolVersion).toBe("2025-06-18");
    const lines = (parse(readFileSync(file(), "utf8")).replies ?? "").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- agent \(.*\): one$/);
    expect(lines[1]).toMatch(/: two$/);
  });

  it("exits 0 on empty input", async () => {
    expect((await session([])).code).toBe(0);
  });
});

describe("replyLine", () => {
  it("is one line", () => {
    expect(replyLine("me", "a\r\nb\u2028c", new Date("2026-10-10T12:00:00.123Z"))).toBe("- me (2026-10-10T12:00:00Z): a b c");
  });
});
