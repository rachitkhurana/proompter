export const REDACTED = "[redacted]";
export const MAX_EXCERPT = 2048;
/** Hard cap on text handed to the redactor (everything is linear-time, this is belt and braces). */
const MAX_REDACT_INPUT = 128 * 1024;

const DROPPED_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);

// Single source of truth for "this key name is sensitive" (used for JSON keys, headers, query
// params and key=value text).
const SENSITIVE_WORDS =
  "token|secret|pass(?:word|wd)|pwd|api[_-]?key|authorization|credential|cookie|signature|jwt|session|(?:^|[_.-])auth(?:$|[_.-])";
export const SENSITIVE_KEY = new RegExp(`${SENSITIVE_WORDS}|^(?:key|sig|code)$`, "i");

// Every pattern below is anchored with a lookbehind (or a distinctive prefix) so a long run of
// token characters is scanned once, not once per start position: linear time on hostile input.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic|Token)\s+[\w.~+/=-]+/gi;
const QUERY_PAIR = /([?&;])([^=&#\s]+)=([^&#\s]*)/g;
// Key (optionally quoted) and its `:`/`=` separator. The value is matched separately, only for
// sensitive keys, so non-sensitive pairs never cost a value scan.
const KEY_SEP = /(?<![\w.-])(["']?)([\w.-]+)\1\s*[:=]\s*/g;
const VALUE = /(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"?|\[redacted\]|[^\s,;&}\]"]+)/iy;
const TOKEN_BREAK = new Set([" ", "\n", "\r", "\t", ",", ";", "&", '"', "'", "{", "}", "[", "]", "(", ")", "<", ">"]);

export function redactString(s: string): string {
  return s.replace(JWT, REDACTED).replace(EMAIL, REDACTED).replace(BEARER, `$1 ${REDACTED}`);
}

export function redactValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") return redactString(v);
  if (v === null || typeof v !== "object") return v;
  if (depth > 8) return REDACTED;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = SENSITIVE_KEY.test(k) && val !== null && val !== undefined ? REDACTED : redactValue(val, depth + 1);
  }
  return out;
}

function maskQuery(s: string): string {
  return s.replace(QUERY_PAIR, (m, sep: string, key: string) =>
    SENSITIVE_KEY.test(safeDecode(key)) ? `${sep}${key}=${REDACTED}` : m,
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function maskKeyValues(s: string): string {
  const re = new RegExp(KEY_SEP.source, "g");
  const val = new RegExp(VALUE.source, "iy");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const key = m[2] ?? "";
    const valStart = m.index + m[0].length;
    if (!SENSITIVE_KEY.test(key)) continue; // lastIndex is already past the separator
    val.lastIndex = valStart;
    const vm = val.exec(s);
    if (!vm) continue;
    const valEnd = valStart + vm[0].length;
    const core = vm[0].replace(/^(?:Bearer|Basic|Token)\s+/i, "");
    if (core !== REDACTED && core !== `"${REDACTED}"`) {
      out += s.slice(last, valStart) + (vm[0].startsWith('"') ? `"${REDACTED}"` : REDACTED);
      last = valEnd;
    }
    re.lastIndex = valEnd;
  }
  return out + s.slice(last);
}

/** Redacts a URL: sensitive query params are masked, JWTs and (percent-encoded) emails anywhere too. */
export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  const masked = q === -1 ? url : url.slice(0, q) + maskQuery(url.slice(q));
  return redactString(masked);
}

/** Redacts free text, a JSON body, or a form-encoded body. Always run BEFORE truncating. */
export function redactText(text: string): string {
  if (text.length > MAX_REDACT_INPUT) text = boundText(text, MAX_REDACT_INPUT, true);
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed), 0));
    } catch {
      /* truncated or not JSON: fall through to the textual pass */
    }
  }
  let out = text;
  if (/^[\w.%[\]-]+=/.test(trimmed)) out = maskQuery("&" + out).slice(1);
  return redactString(maskKeyValues(out));
}

/** Drops authorization/cookie headers, masks sensitive-keyed headers and secret-looking values. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (DROPPED_HEADERS.has(key)) continue;
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactString(v);
  }
  return out;
}

/**
 * Bounds text read from a body BEFORE redaction. If it was cut (`partial`, or longer than `limit`),
 * the trailing partial token is dropped so a half-read JWT/key can't slip past the redactors.
 */
export function boundText(s: string, limit: number, partial = false): string {
  if (s.length > limit) {
    s = s.slice(0, limit);
    partial = true;
  }
  if (!partial) return s;
  let end = s.length;
  while (end > 0 && !TOKEN_BREAK.has(s[end - 1] as string)) end--;
  return s.slice(0, end);
}

/** Truncates to at most `max` chars (including the trailing ellipsis). Run AFTER redaction. */
export function excerpt(s: string, max = MAX_EXCERPT): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
