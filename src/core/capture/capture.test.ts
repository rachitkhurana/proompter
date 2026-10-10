import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapture } from "./index.ts";
import { REDACTED } from "./redact.ts";
import { FakeXHR, makeWin } from "./helpers.test-util.ts";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123_-xyz";

afterEach(() => {
  FakeXHR.plan = { status: 200, body: "" };
});

describe("zero cost when off", () => {
  it("patches nothing until enable()", () => {
    const win = makeWin();
    const { error, warn } = win.console;
    const { fetch } = win;
    const send = FakeXHR.prototype.send;
    createCapture({ win });
    expect(win.console.error).toBe(error);
    expect(win.console.warn).toBe(warn);
    expect(win.fetch).toBe(fetch);
    expect(FakeXHR.prototype.send).toBe(send);
  });
});

describe("patch / restore", () => {
  it("restores originals, twice, and is idempotent", () => {
    const win = makeWin();
    const origs = { error: win.console.error, warn: win.console.warn, fetch: win.fetch, send: FakeXHR.prototype.send, open: FakeXHR.prototype.open };
    const cap = createCapture({ win });
    for (let i = 0; i < 2; i++) {
      cap.enable();
      cap.enable();
      expect(win.console.error).not.toBe(origs.error);
      expect(win.fetch).not.toBe(origs.fetch);
      expect(FakeXHR.prototype.send).not.toBe(origs.send);
      cap.disable();
      cap.disable();
      expect(win.console.error).toBe(origs.error);
      expect(win.console.warn).toBe(origs.warn);
      expect(win.fetch).toBe(origs.fetch);
      expect(FakeXHR.prototype.send).toBe(origs.send);
      expect(FakeXHR.prototype.open).toBe(origs.open);
    }
  });

  it("does not clobber a host patch applied after ours, and stops capturing", async () => {
    const win = makeWin();
    const cap = createCapture({ win });
    const origConsoleError = win.console.error;
    cap.enable();
    const ours = win.fetch;
    const hostCalls: string[] = [];
    const hostFetch = (async (...a: Parameters<typeof fetch>) => {
      hostCalls.push("host");
      return ours(...a);
    }) as typeof fetch;
    win.fetch = hostFetch;

    cap.disable();
    expect(win.fetch).toBe(hostFetch); // host wrapper survives
    expect(win.console.error).toBe(origConsoleError); // unpatched-by-host targets are restored

    await win.fetch("https://x.test/a");
    expect(hostCalls).toEqual(["host"]);
    await Promise.resolve();
    expect(cap.context().network).toHaveLength(0); // pass-through while disabled

    cap.enable(); // our wrapper is still in the chain, capture resumes
    await win.fetch("https://x.test/b");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));
  });
});

describe("console", () => {
  it("captures error and warn with message and first stack frame, still calls through", () => {
    const win = makeWin();
    const orig = win.console.error as ReturnType<typeof vi.fn>;
    const cap = createCapture({ win });
    cap.enable();
    win.console.error("boom", { a: 1 });
    win.console.warn(new Error("careful"));
    win.console.log("ignored");
    const { console: c } = cap.context();
    expect(orig).toHaveBeenCalledWith("boom", { a: 1 });
    expect(c.map((e) => e.level)).toEqual(["error", "warn"]);
    expect(c[0]?.message).toBe('boom {"a":1}');
    expect(c[0]?.frame).toMatch(/capture\.test|at |@/);
    expect(c[1]?.message).toBe("Error: careful");
    expect(typeof c[0]?.timestamp).toBe("number");
  });

  it("redacts before storing", () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    win.console.error(`login failed for a@b.com with ${JWT} token=abc`);
    const msg = cap.context().console[0]?.message ?? "";
    expect(msg).not.toMatch(/a@b\.com|eyJ|abc/);
  });

  it("caps the buffer at 50, keeping the newest", () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    for (let i = 0; i < 120; i++) win.console.warn(`m${i}`);
    const c = cap.context().console;
    expect(c).toHaveLength(50);
    expect(c[0]?.message).toBe("m70");
    expect(c[49]?.message).toBe("m119");
  });
});

describe("fetch", () => {
  it("captures method, url, status, duration, excerpts, with redaction", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ user: "a@b.com", accessToken: "t0k", ok: true }), {
        status: 201,
        headers: { "content-type": "application/json", "set-cookie": "s=1", "x-req": "1" },
      }),
    ) as unknown as typeof fetch;
    const win = makeWin(f);
    const cap = createCapture({ win });
    cap.enable();
    const res = await win.fetch("https://x.test/api?token=abc&page=1", {
      method: "post",
      headers: { Authorization: "Bearer zzz", "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", name: "n" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true }); // host can still read the body
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));
    const e = cap.context().network[0]!;
    expect(e).toMatchObject({ kind: "fetch", method: "POST", status: 201, ok: true });
    expect(e.url).toBe(`https://x.test/api?token=${REDACTED}&page=1`);
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
    expect(e.requestHeaders).toEqual({ "content-type": "application/json" });
    expect(e.responseHeaders).toEqual({ "content-type": "application/json", "x-req": "1" });
    expect(JSON.parse(e.requestExcerpt!)).toEqual({ password: REDACTED, name: "n" });
    expect(JSON.parse(e.responseExcerpt!)).toEqual({ user: REDACTED, accessToken: REDACTED, ok: true });
  });

  it("records HTTP error statuses", async () => {
    const win = makeWin(vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch);
    const cap = createCapture({ win });
    cap.enable();
    await win.fetch("/x");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));
    expect(cap.context().network[0]).toMatchObject({ status: 500, ok: false, responseExcerpt: "nope" });
  });

  it("records network failures and rethrows to the host", async () => {
    const win = makeWin(vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch);
    const cap = createCapture({ win });
    cap.enable();
    await expect(win.fetch("/x")).rejects.toThrow("Failed to fetch");
    const e = cap.context().network[0]!;
    expect(e).toMatchObject({ status: null, ok: false, error: "TypeError: Failed to fetch" });
  });

  it("truncates excerpts to 2 KB", async () => {
    const win = makeWin(vi.fn(async () => new Response("a".repeat(10_000))) as unknown as typeof fetch);
    const cap = createCapture({ win });
    cap.enable();
    await win.fetch("/x", { method: "POST", body: "b".repeat(10_000) });
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));
    const e = cap.context().network[0]!;
    expect(e.responseExcerpt!.length).toBeLessThanOrEqual(2048);
    expect(e.requestExcerpt!.length).toBeLessThanOrEqual(2048);
  });

  it("caps the buffer at 50", async () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    for (let i = 0; i < 60; i++) await win.fetch(`/r${i}`);
    await vi.waitFor(() => expect(cap.context().network.length).toBe(50));
    expect(cap.context().network.some((e) => e.url === "/r0")).toBe(false);
  });
});

describe("xhr", () => {
  function run(win: ReturnType<typeof makeWin>, method: string, url: string, body?: string) {
    const x = new win.XMLHttpRequest();
    x.open(method, url);
    x.setRequestHeader("Authorization", "Bearer q");
    x.setRequestHeader("X-Test", "1");
    x.send(body);
    return x;
  }

  it("captures a successful call with redaction", async () => {
    FakeXHR.plan = { status: 200, body: '{"secret":"s","v":1}', headers: "Content-Type: application/json\r\nSet-Cookie: a=b\r\n" };
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    run(win, "put", "/api?api_key=k&q=1", '{"password":"p"}');
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));
    const e = cap.context().network[0]!;
    expect(e).toMatchObject({ kind: "xhr", method: "PUT", status: 200, ok: true });
    expect(e.url).toBe(`/api?api_key=${REDACTED}&q=1`);
    expect(e.requestHeaders).toEqual({ "x-test": "1" });
    expect(e.responseHeaders).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(e.requestExcerpt!)).toEqual({ password: REDACTED });
    expect(JSON.parse(e.responseExcerpt!)).toEqual({ secret: REDACTED, v: 1 });
  });

  it("captures HTTP errors and network failures", async () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    FakeXHR.plan = { status: 404, body: "missing" };
    run(win, "GET", "/a");
    FakeXHR.plan = { status: 0, body: "", fail: "error" };
    run(win, "GET", "/b");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(2));
    const [a, b] = cap.context().network;
    expect(a).toMatchObject({ status: 404, ok: false });
    expect(b).toMatchObject({ status: null, ok: false, error: "Network error" });
  });

  it("does not record when disabled", async () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    cap.disable();
    run(win, "GET", "/a");
    await Promise.resolve();
    await Promise.resolve();
    expect(cap.context().network).toHaveLength(0);
  });
});

describe("hooks and adapters", () => {
  it("runs the host redact hook after built-in redaction; null drops the entry", () => {
    const win = makeWin();
    const seen: string[] = [];
    const cap = createCapture({
      win,
      redact: (e) => {
        if ("message" in e) {
          seen.push(e.message);
          if (e.message.includes("drop")) return null;
          return { ...e, message: e.message.replace("secret-thing", "X") };
        }
        return e;
      },
    });
    cap.enable();
    win.console.error("a@b.com secret-thing");
    win.console.error("drop me");
    expect(seen[0]).toBe(`${REDACTED} secret-thing`); // built-in ran first
    expect(cap.context().console.map((e) => e.message)).toEqual([`${REDACTED} X`]);
  });

  it("fails closed and keeps going when the hook throws", () => {
    const win = makeWin();
    const cap = createCapture({ win, redact: () => { throw new Error("hook bug"); } });
    cap.enable();
    expect(() => win.console.error("x")).not.toThrow();
    const ctx = cap.context();
    expect(ctx.console).toHaveLength(0);
    expect(ctx.internalErrors[0]?.where).toBe("redact-hook");
  });

  it("returns the queries snapshot and survives a throwing adapter", () => {
    const win = makeWin();
    const ok = createCapture({ win, queries: () => [{ key: ["a"], status: "success", updatedAt: 1 }] });
    expect(ok.context().queries).toEqual([{ key: ["a"], status: "success", updatedAt: 1 }]);
    const bad = createCapture({ win, queries: () => { throw new Error("nope"); } });
    expect(bad.context().queries).toEqual([]);
    expect(bad.context().internalErrors[0]?.where).toBe("queries");
  });
});
