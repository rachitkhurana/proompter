import { createPatch, type Patch } from "./patch.ts";
import { boundText } from "./redact.ts";
import type { CaptureConsoleEntry } from "./types.ts";

export interface ConsoleSink {
  /** Receives UNREDACTED entries; the sink must redact before storing. */
  push(entry: CaptureConsoleEntry): void;
  fail(where: string, e: unknown): void;
}

const MESSAGE_LIMIT = 64 * 1024;
// V8: `    at fn (url:1:2)`. Firefox/Safari: `fn@url:1:2` (the `@` must come before any whitespace, so
// a message line like `Error: user@x.com failed` is not mistaken for a frame).
const V8_FRAME = /^\s*at\s/;
const GECKO_FRAME = /^[^\s@]*@\S+:\d+/;

function frames(stack: string | undefined): string[] {
  return (stack ?? "").split("\n").filter((l) => V8_FRAME.test(l) || GECKO_FRAME.test(l));
}

function describe(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === undefined) return "undefined";
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(arg, (_k, v: unknown) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return typeof v === "bigint" ? v.toString() : v;
    });
    return json ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** console-style formatting: `%s %d %i %f %o %O %j %c %%` substitution, then the remaining args. */
export function formatArgs(args: unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== "string" || !first.includes("%") || rest.length === 0) return args.map(describe).join(" ");
  let i = 0;
  const head = first.replace(/%([sdifoOjc%])/g, (m, t: string) => {
    if (t === "%") return "%";
    if (i >= rest.length) return m;
    const a = rest[i++];
    switch (t) {
      case "s":
        return describe(a);
      case "d":
      case "i":
        return String(t === "i" ? Math.trunc(Number(a)) : Number(a));
      case "f":
        return String(Number(a));
      case "c":
        return "";
      default:
        return describe(a);
    }
  });
  return [head, ...rest.slice(i).map(describe)].join(" ");
}

export function createConsolePatches(win: Window & typeof globalThis, sink: ConsoleSink): Patch[] {
  return (["error", "warn"] as const).map((level) =>
    createPatch(win.console, level, (orig, state) =>
      function (this: unknown, ...args: never[]) {
        if (state.on) {
          try {
            const errArg = (args as unknown[]).find((a): a is Error => a instanceof Error);
            // Own stack: [wrapper, caller, ...]. Skip our wrapper frame.
            const frame = errArg ? frames(errArg.stack)[0] : frames(new Error().stack)[1];
            sink.push({
              timestamp: Date.now(),
              level,
              message: boundText(formatArgs(args as unknown[]), MESSAGE_LIMIT),
              ...(frame ? { frame: frame.trim() } : {}),
            });
          } catch (e) {
            sink.fail(`console.${level}`, e);
          }
        }
        return Reflect.apply(orig, this, args);
      },
    ),
  );
}
