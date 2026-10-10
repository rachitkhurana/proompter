import { describe, expect, it } from "vitest";
import { REDACTED, boundText, excerpt, redactHeaders, redactText, redactUrl } from "./redact.ts";

describe("hardening", () => {
  it("runs in linear time on hostile input", () => {
    const inputs = [
      "a".repeat(65536),
      "a=".repeat(32768),
      "a@".repeat(32768),
      "a@" + "a".repeat(65536),
      "password=".repeat(8192),
      "eyJ".repeat(21000),
      "Bearer ".repeat(9000),
      "&".repeat(65536),
      `"${"k".repeat(65536)}`,
    ];
    for (const i of inputs) {
      const t = performance.now();
      redactText(i);
      expect(performance.now() - t).toBeLessThan(50);
    }
  });

  it("masks bearer / basic tokens in free text and as key values", () => {
    expect(redactText("Auth failed: Bearer abc123")).toBe(`Auth failed: Bearer ${REDACTED}`);
    expect(redactText("basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    const out = redactText("token: Bearer abc.def and more");
    expect(out).not.toContain("abc.def");
    expect(redactText(out)).toBe(out);
  });

  it("treats more key names as sensitive", () => {
    const body = JSON.parse(
      redactText(
        JSON.stringify({ passwd: "1", pwd: "2", auth: "3", Authorization: "4", sessionId: "5", credentials: "6", cookie: "7", signature: "8", jwt: "9", key: "a", sig: "b", code: "c", author: "visible", keyboard: "visible" }),
      ),
    );
    for (const k of ["passwd", "pwd", "auth", "Authorization", "sessionId", "credentials", "cookie", "signature", "jwt", "key", "sig", "code"]) {
      expect(body[k]).toBe(REDACTED);
    }
    expect(body.author).toBe("visible");
    expect(body.keyboard).toBe("visible");
    expect(redactUrl("/cb?code=xyz&state=1")).toBe(`/cb?code=${REDACTED}&state=1`);
    expect(redactText("session=abc123 pwd: hunter2")).not.toMatch(/abc123|hunter2/);
  });

  it("masks percent-encoded emails in URLs and form bodies", () => {
    expect(redactUrl("/u?email=a%40b.com&p=1")).not.toContain("a%40b.com");
    expect(redactUrl("/u?email=a%40b.com&p=1")).toContain("p=1");
    expect(redactText("name=bob&email=a%40b.com")).not.toContain("a%40b.com");
  });

  it("drops a trailing partial token when cutting, so a split JWT can't survive", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123_-xyz";
    const body = "pad ".repeat(10) + jwt;
    const cut = boundText(body, 40 + 30); // cuts mid-JWT
    expect(cut).toBe("pad ".repeat(10));
    expect(boundText("short", 100)).toBe("short");
    expect(boundText("a b partial", 100, true)).toBe("a b ");
  });
});

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123_-xyz";

describe("redactHeaders", () => {
  it("drops authorization, cookie and set-cookie, keeps the rest", () => {
    const out = redactHeaders({
      Authorization: "Bearer abc",
      Cookie: "sid=1",
      "Set-Cookie": "sid=2",
      "Content-Type": "application/json",
    });
    expect(out).toEqual({ "content-type": "application/json" });
  });

  it("masks sensitive-keyed headers and secret-looking values", () => {
    const out = redactHeaders({ "X-Api-Key": "k", "X-Auth-Token": "t", "X-User": "a@b.co", "X-J": JWT });
    expect(out["x-api-key"]).toBe(REDACTED);
    expect(out["x-auth-token"]).toBe(REDACTED);
    expect(out["x-user"]).toBe(REDACTED);
    expect(out["x-j"]).toBe(REDACTED);
  });
});

describe("redactText", () => {
  it("masks emails and JWTs in free text", () => {
    const out = redactText(`user rachit@example.com sent ${JWT} today`);
    expect(out).toBe(`user ${REDACTED} sent ${REDACTED} today`);
  });

  it("masks token-like keys in JSON, including nested and arrays", () => {
    const out = JSON.parse(
      redactText(
        JSON.stringify({ name: "x", password: "p", nested: { accessToken: "t", list: [{ api_key: "k" }] }, apiKey: "z", client_secret: "s" }),
      ),
    );
    expect(out).toEqual({
      name: "x",
      password: REDACTED,
      nested: { accessToken: REDACTED, list: [{ api_key: REDACTED }] },
      apiKey: REDACTED,
      client_secret: REDACTED,
    });
  });

  it("masks secrets in truncated (unparseable) JSON", () => {
    const out = redactText('{"token":"abc123","ok":true,"password":"hun');
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("hun");
    expect(out).toContain('"ok":true');
  });

  it("masks form-encoded bodies", () => {
    const out = redactText("user=bob&password=hunter2&api-key=zzz");
    expect(out).toBe(`user=bob&password=${REDACTED}&api-key=${REDACTED}`);
  });

  it("is idempotent", () => {
    const inputs = [
      "user=bob&password=hunter2&api-key=zzz",
      'token="abc" and password: xyz',
      JSON.stringify({ token: "t", email: "a@b.com" }),
      `x a@b.com ${JWT}`,
    ];
    for (const i of inputs) {
      const once = redactText(i);
      expect(redactText(once)).toBe(once);
    }
    expect(redactText(`password=${REDACTED}`)).toBe(`password=${REDACTED}`);
    const u = redactUrl("/a?token=x&p=1");
    expect(redactUrl(u)).toBe(u);
  });

  it("masks key=value in console-style text", () => {
    expect(redactText("failed with token=abc123 for user")).not.toContain("abc123");
  });
});

describe("redactUrl", () => {
  it("masks sensitive query params and emails, keeps others", () => {
    const out = redactUrl("https://x.test/a?page=2&access_token=abc&email=a@b.com&apiKey=k#h");
    expect(out).toContain("page=2");
    expect(out).toContain(`access_token=${REDACTED}`);
    expect(out).toContain(`apiKey=${REDACTED}`);
    expect(out).not.toContain("a@b.com");
    expect(out).not.toContain("abc&");
  });

  it("leaves urls without a query alone", () => {
    expect(redactUrl("/api/users")).toBe("/api/users");
  });
});

describe("excerpt", () => {
  it("truncates to at most 2048 chars", () => {
    expect(excerpt("a".repeat(5000)).length).toBe(2048);
    expect(excerpt("short")).toBe("short");
  });
});
