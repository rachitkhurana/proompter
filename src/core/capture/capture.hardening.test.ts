import { afterEach, describe, expect, it, vi } from "vitest";
import { formatArgs } from "./console.ts";
import { createCapture } from "./index.ts";
import { REDACTED } from "./redact.ts";
import { FakeXHR, makeWin } from "./helpers.test-util.ts";

afterEach(() => {
  FakeXHR.plan = { status: 200, body: "" };
});

describe("xhr instance reuse", () => {
  it("installs listeners once and records each request exactly once with its own data", async () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    const x = new win.XMLHttpRequest() as unknown as XMLHttpRequest & FakeXHR;

    FakeXHR.plan = { status: 200, body: "first" };
    x.open("GET", "/one");
    x.setRequestHeader("X-A", "1");
    x.send();
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1));

    FakeXHR.plan = { status: 0, body: "", fail: "error" };
    x.open("POST", "/two");
    x.send("b");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(2));
    await Promise.resolve();

    const [a, b] = cap.context().network;
    expect(a).toMatchObject({ url: "/one", method: "GET", status: 200, requestHeaders: { "x-a": "1" } });
    expect(b).toMatchObject({ url: "/two", method: "POST", status: null, error: "Network error" });
    expect(b?.requestHeaders).toBeUndefined(); // reset on open
    expect(x.listenerCount("loadend")).toBe(1);
    expect(x.listenerCount("error")).toBe(1);

    FakeXHR.plan = { status: 200, body: "third" };
    x.open("GET", "/three");
    x.send();
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(3));
    expect(cap.context().network[2]).toMatchObject({ url: "/three", status: 200, ok: true }); // stale error cleared
    expect(cap.context().network[2]?.error).toBeUndefined();
  });
});

describe("streaming and slow responses", () => {
  it("does not wait on event-stream / ndjson responses", async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} });
    const win = makeWin(
      vi.fn(async () => new Response(never, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch,
    );
    const cap = createCapture({ win });
    cap.enable();
    await win.fetch("/sse");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1), { timeout: 500 });
    expect(cap.context().network[0]).toMatchObject({ status: 200, responseExcerpt: "[streaming body]" });
  });

  it("gives up on a stalled body after ~2s but still records the entry with the partial excerpt", async () => {
    const enc = new TextEncoder();
    const stalled = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("hello world partia"));
      },
    });
    const win = makeWin(
      vi.fn(async () => new Response(stalled, { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    );
    const cap = createCapture({ win });
    cap.enable();
    await win.fetch("/slow");
    await vi.waitFor(() => expect(cap.context().network).toHaveLength(1), { timeout: 5000 });
    // partial trailing token dropped
    expect(cap.context().network[0]?.responseExcerpt).toBe("hello world ");
  }, 10_000);
});

describe("console details", () => {
  it("does not mistake an email in the message for a stack frame", () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    const err = new Error("user@x.com failed");
    err.stack = "Error: user@x.com failed\n    at doThing (http://host/app.js:10:5)";
    win.console.error(err);
    const e = cap.context().console[0]!;
    expect(e.frame).toBe("at doThing (http://host/app.js:10:5)");
    expect(e.message).toBe(`Error: ${REDACTED} failed`);

    const g = new Error("user@x.com failed");
    g.stack = "Error: user@x.com failed\nrender@http://host/app.js:3:4";
    win.console.warn(g);
    expect(cap.context().console[1]?.frame).toBe("render@http://host/app.js:3:4");
  });

  it("redacts secrets inside the frame url", () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    const err = new Error("x");
    err.stack = "Error: x\n    at f (http://host/app.js?token=abc123:1:2)";
    win.console.error(err);
    expect(cap.context().console[0]?.frame).not.toContain("abc123");
  });

  it("substitutes %s %d %o and appends the rest", () => {
    expect(formatArgs(["user %s has %d items", "bob", 3])).toBe("user bob has 3 items");
    expect(formatArgs(["obj %o", { a: 1 }, "tail"])).toBe('obj {"a":1} tail');
    expect(formatArgs(["100%% of %s", "x"])).toBe("100% of x");
    expect(formatArgs(["no args %s"])).toBe("no args %s");
    expect(formatArgs(["a", 1, { b: 2 }])).toBe('a 1 {"b":2}');
  });

  it("redacts after substitution", () => {
    const win = makeWin();
    const cap = createCapture({ win });
    cap.enable();
    win.console.error("failed for %s", "a@b.com");
    expect(cap.context().console[0]?.message).toBe(`failed for ${REDACTED}`);
  });
});
