import { createPatch, type Patch } from "./patch.ts";
import { boundText } from "./redact.ts";
import type { CaptureNetworkEntry } from "./types.ts";

export interface NetworkSink {
  /** Receives UNREDACTED entries; the sink must redact (and truncate) before storing. */
  push(entry: CaptureNetworkEntry): void;
  fail(where: string, e: unknown): void;
}

/** Read at most this much of a body before redaction/truncation. */
const READ_LIMIT = 64 * 1024;
/** Give up on a response body that hasn't finished after this long. */
export const READ_TIMEOUT_MS = 2000;
const BINARY = /image\/|video\/|audio\/|font\/|octet-stream|zip|pdf/i;
const STREAMING = /event-stream|x-ndjson|stream\+json/i;

const now = (win: Window): number => win.performance?.now?.() ?? Date.now();

function headersToRecord(h: Headers | undefined | null): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function bodyToText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return boundText(body, READ_LIMIT);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return boundText(body.toString(), READ_LIMIT);
  return "[non-text body]";
}

/** Resolves to undefined if `p` hasn't settled within `ms`. */
function race<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) return Promise.resolve(undefined);
  p.catch(() => {}); // a late rejection after the timeout must not go unhandled
  return new Promise<T | undefined>((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function readResponseText(res: Response): Promise<string | undefined> {
  const ct = res.headers.get("content-type") ?? "";
  if (STREAMING.test(ct)) return "[streaming body]";
  if (BINARY.test(ct)) return "[binary body]";
  const deadline = Date.now() + READ_TIMEOUT_MS;
  const clone = res.clone();
  const reader = clone.body?.getReader?.();
  if (!reader) {
    const t = await race(clone.text(), READ_TIMEOUT_MS);
    return t === undefined ? undefined : boundText(t, READ_LIMIT);
  }
  const dec = new TextDecoder();
  let text = "";
  let partial = false;
  while (text.length < READ_LIMIT) {
    const r = await race(reader.read(), deadline - Date.now());
    if (!r) {
      partial = true; // timed out: the stream isn't finishing
      break;
    }
    if (r.done) break;
    text += dec.decode(r.value, { stream: true });
  }
  void reader.cancel().catch(() => {});
  return boundText(text, READ_LIMIT, partial);
}

function parseRawHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

export function createFetchPatch(win: Window & typeof globalThis, sink: NetworkSink): Patch {
  return createPatch(win, "fetch", (orig, state) =>
    function (this: unknown, ...args: never[]) {
      if (!state.on) return Reflect.apply(orig, this, args);
      const [input, init] = args as unknown as [RequestInfo | URL, RequestInit | undefined];
      const start = now(win);
      let method = "GET";
      let url = "";
      let requestHeaders: Record<string, string> | undefined;
      let requestExcerpt: string | undefined;
      try {
        const inp = input as unknown as { method?: string; href?: string; url?: string; headers?: Headers };
        url = typeof input === "string" ? input : (inp.href ?? inp.url ?? String(input));
        method = (init?.method ?? (typeof input === "object" ? inp.method : undefined) ?? "GET").toUpperCase();
        requestHeaders = init?.headers
          ? headersToRecord(new Headers(init.headers))
          : typeof input === "object"
            ? headersToRecord(inp.headers)
            : undefined;
        requestExcerpt = bodyToText(init?.body);
      } catch (e) {
        sink.fail("fetch:request", e);
      }
      const base = {
        timestamp: Date.now(),
        kind: "fetch" as const,
        method,
        url,
        ...(requestHeaders ? { requestHeaders } : {}),
        ...(requestExcerpt !== undefined ? { requestExcerpt } : {}),
      };
      const result = Reflect.apply(orig, this, args) as Promise<Response>;
      return Promise.resolve(result).then(
        (res) => {
          const durationMs = Math.round(now(win) - start);
          void (async () => {
            try {
              const responseExcerpt = await readResponseText(res).catch(() => undefined);
              const responseHeaders = headersToRecord(res.headers);
              sink.push({
                ...base,
                status: res.status,
                ok: res.ok,
                durationMs,
                ...(responseHeaders ? { responseHeaders } : {}),
                ...(responseExcerpt !== undefined ? { responseExcerpt } : {}),
              });
            } catch (e) {
              sink.fail("fetch:response", e);
            }
          })();
          return res;
        },
        (err: unknown) => {
          try {
            sink.push({
              ...base,
              status: null,
              ok: false,
              durationMs: Math.round(now(win) - start),
              error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            });
          } catch (e) {
            sink.fail("fetch:error", e);
          }
          throw err;
        },
      );
    },
  );
}

/** Per-XHR-instance state. Listeners are installed once; everything they read lives here. */
interface XhrState {
  method: string;
  url: string;
  headers: Record<string, string>;
  error?: string;
  start: number;
  startedAt: number;
  requestExcerpt?: string;
  /** True between send() and loadend. */
  pending: boolean;
  listening: boolean;
}

export function createXhrPatches(win: Window & typeof globalThis, sink: NetworkSink): Patch[] {
  const proto = win.XMLHttpRequest?.prototype;
  if (!proto) return [];
  const states = new WeakMap<object, XhrState>();

  const open = createPatch(proto, "open", (orig, state) =>
    function (this: XMLHttpRequest, ...args: never[]) {
      if (state.on) {
        try {
          const [method, url] = args as unknown as [string, string | URL];
          const prev = states.get(this);
          // Reuse the instance (and its listeners) but reset everything per request.
          states.set(this, {
            method: String(method).toUpperCase(),
            url: String(url),
            headers: {},
            start: 0,
            startedAt: 0,
            pending: false,
            listening: prev?.listening ?? false,
          });
        } catch (e) {
          sink.fail("xhr:open", e);
        }
      }
      return Reflect.apply(orig, this, args);
    },
  );

  const setHeader = createPatch(proto, "setRequestHeader", (orig, state) =>
    function (this: XMLHttpRequest, ...args: never[]) {
      if (state.on) {
        try {
          const [k, v] = args as unknown as [string, string];
          const st = states.get(this);
          if (st) st.headers[String(k).toLowerCase()] = String(v);
        } catch (e) {
          sink.fail("xhr:setRequestHeader", e);
        }
      }
      return Reflect.apply(orig, this, args);
    },
  );

  const send = createPatch(proto, "send", (orig, state) =>
    function (this: XMLHttpRequest, ...args: never[]) {
      const st = state.on ? states.get(this) : undefined;
      if (st) {
        try {
          st.start = now(win);
          st.startedAt = Date.now();
          st.requestExcerpt = bodyToText((args as unknown[])[0]);
          st.error = undefined;
          st.pending = true;
          if (!st.listening) {
            st.listening = true;
            for (const ev of ["error", "abort", "timeout"] as const) {
              this.addEventListener(ev, () => {
                const cur = states.get(this);
                if (cur) cur.error ??= ev === "error" ? "Network error" : ev === "abort" ? "Aborted" : "Timeout";
              });
            }
            this.addEventListener("loadend", () => {
              const cur = states.get(this);
              if (!cur?.pending) return;
              cur.pending = false;
              try {
                const failed = cur.error !== undefined || this.status === 0;
                let responseExcerpt: string | undefined;
                if (!failed) {
                  const rt = this.responseType;
                  responseExcerpt =
                    rt === "" || rt === "text" ? boundText(this.responseText ?? "", READ_LIMIT) : "[non-text body]";
                }
                const raw = this.getAllResponseHeaders?.();
                const responseHeaders = raw ? parseRawHeaders(raw) : undefined;
                sink.push({
                  timestamp: cur.startedAt,
                  kind: "xhr",
                  method: cur.method,
                  url: cur.url,
                  status: failed ? null : this.status,
                  ok: !failed && this.status >= 200 && this.status < 300,
                  durationMs: Math.round(now(win) - cur.start),
                  ...(failed ? { error: cur.error ?? "Network error" } : {}),
                  ...(Object.keys(cur.headers).length ? { requestHeaders: cur.headers } : {}),
                  ...(responseHeaders && Object.keys(responseHeaders).length ? { responseHeaders } : {}),
                  ...(cur.requestExcerpt !== undefined ? { requestExcerpt: cur.requestExcerpt } : {}),
                  ...(responseExcerpt !== undefined ? { responseExcerpt } : {}),
                });
              } catch (e) {
                sink.fail("xhr:loadend", e);
              }
            });
          }
        } catch (e) {
          sink.fail("xhr:send", e);
        }
      }
      return Reflect.apply(orig, this, args);
    },
  );

  return [open, setHeader, send];
}
