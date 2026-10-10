/**
 * Running host plugins (DESIGN §9) without letting a bad plugin hurt the host, the composer or a sink.
 *
 * - `taskFor`, `context`, `testPlan` are advisory: a plugin that throws or returns junk is skipped.
 * - `redact` is a safety net, so it FAILS CLOSED: if any plugin's `redact` throws, or returns something that is
 *   not a well-formed entry for the same id, `applyRedact` reports failure and the caller must not persist or
 *   emit the entry. The unredacted entry never reaches a sink on that path. (The composer keeps itself open and
 *   says why; the user's text is not lost.)
 * - Every `redact` receives a deep clone, so a plugin that mutates its argument and then throws cannot
 *   change the entry the caller holds.
 */
import { redactConsoleEntry, redactNetworkEntry, redactString, redactText, redactUrl, redactValue } from "./capture/redact";
import type { Entry, ProompterPlugin } from "./entry";

export type Plugins = readonly ProompterPlugin[] | undefined;

/** First non-empty task id any plugin returns for this source and route. Plugin errors are skipped. */
export function pluginTask(plugins: Plugins, t: { source?: string; route: string }): string | null {
  for (const p of plugins ?? []) {
    if (!p.taskFor) continue;
    try {
      const v = p.taskFor({ ...t });
      if (typeof v === "string" && v.trim() !== "") return v;
    } catch {
      // A broken plugin must not break the composer.
    }
  }
  return null;
}

/** Extra frontmatter fields, merged in plugin order (later plugins win). Plugin errors are skipped. */
export function pluginContext(plugins: Plugins): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const p of plugins ?? []) {
    if (!p.context) continue;
    try {
      const v = p.context();
      if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, v);
    } catch {
      // skipped
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Test plan sections for the composer's menu: every plugin's `testPlan`, de-duplicated, in order. */
export function pluginTestPlan(plugins: Plugins): string[] {
  const seen = new Set<string>();
  for (const p of plugins ?? []) {
    const list: unknown = p.testPlan;
    if (!Array.isArray(list)) continue;
    for (const s of list) if (typeof s === "string" && s.trim() !== "") seen.add(s);
  }
  return [...seen];
}

export type RedactResult = { ok: true; entry: Entry } | { ok: false; plugin: string; error: string };

export class RedactError extends Error {
  readonly plugin: string;
  constructor(plugin: string, detail: string) {
    super(`redact plugin '${plugin}' failed: ${detail}`);
    this.name = "RedactError";
    this.plugin = plugin;
  }
}

/** The minimum a sink relies on. A plugin cannot re-address the entry (id, n, session) or break its shape. */
function wellFormed(out: unknown, original: Entry): out is Entry {
  if (!out || typeof out !== "object") return false;
  const e = out as Partial<Entry>;
  return (
    e.id === original.id &&
    e.n === original.n &&
    e.session === original.session &&
    typeof e.title === "string" &&
    typeof e.description === "string" &&
    Array.isArray(e.tags) &&
    Array.isArray(e.targets) &&
    Array.isArray(e.activity) &&
    !!e.context &&
    Array.isArray(e.context.console) &&
    Array.isArray(e.context.network) &&
    Array.isArray(e.context.queries)
  );
}

/**
 * The built-in redaction (T06's `redactText` and friends) over everything free-form an entry carries: title,
 * description, quote, console lines, network URLs / headers / excerpts, and a parsed context summary. It always
 * runs first (D3.4), whatever plugins are installed, so plugins only ever see already-redacted text.
 */
export function builtinRedact(e: Entry): Entry {
  const ctx = e.context;
  const s = ctx.summary;
  const target = (t: Entry["targets"][number]) => ({
    ...t,
    selector: redactString(t.selector),
    source: t.source === null ? null : redactString(t.source),
    label: redactText(t.label),
    component: redactText(t.component),
  });
  const targets = e.targets.map(target);
  const optional = (v: string | undefined) => (v === undefined ? undefined : redactText(v));
  return {
    ...e,
    title: redactText(e.title),
    description: redactText(e.description),
    route: redactUrl(e.route),
    tags: e.tags.map(redactText),
    issue: e.issue === null ? null : redactText(e.issue),
    targets,
    ...(e.target ? { target: target(e.target) } : {}),
    ...(e.task !== undefined ? { task: optional(e.task) } : {}),
    ...(e.testPlan !== undefined ? { testPlan: optional(e.testPlan) } : {}),
    ...(e.extra ? { extra: redactValue(e.extra, 0) as Record<string, unknown> } : {}),
    ...(e.quote !== undefined ? { quote: redactText(e.quote) } : {}),
    context: {
      ...ctx,
      ...(ctx.build !== undefined ? { build: redactText(ctx.build) } : {}),
      queries: ctx.queries.map((q) => ({ ...q, key: redactValue(q.key, 0), status: redactText(q.status) })),
      console: ctx.console.map(redactConsoleEntry),
      network: ctx.network.map(redactNetworkEntry),
      ...(s
        ? { summary: { ...s, consoleItems: s.consoleItems.map(redactText), networkItems: s.networkItems.map(redactText) } }
        : {}),
    },
  };
}

/**
 * Built-in redaction first, then every plugin's `redact` in order. See the file comment for the fail-closed
 * rule; a built-in failure fails closed too (reported as plugin "built-in").
 */
export function applyRedact(plugins: Plugins, entry: Entry): RedactResult {
  let current: Entry;
  try {
    current = builtinRedact(entry);
  } catch (e) {
    return { ok: false, plugin: "built-in", error: e instanceof Error ? e.message : String(e) };
  }
  for (const p of plugins ?? []) {
    if (!p.redact) continue;
    try {
      const out: unknown = p.redact(structuredClone(current));
      if (!wellFormed(out, entry)) return { ok: false, plugin: p.name, error: "returned something that is not the same entry" };
      current = out;
    } catch (e) {
      return { ok: false, plugin: p.name, error: e instanceof Error ? e.message : String(e) };
    }
  }
  // Hand back a copy no plugin still holds a reference to.
  try {
    return { ok: true, entry: structuredClone(current) };
  } catch (e) {
    return { ok: false, plugin: "(clone)", error: e instanceof Error ? e.message : String(e) };
  }
}
