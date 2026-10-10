/**
 * `proompter mcp` (DESIGN D20): a hand-written MCP server over stdio. Newline-delimited JSON-RPC 2.0, no dependency.
 * stdout carries protocol messages only; every log goes to stderr. Requests are handled one at a time.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { CliError, findEntry, listEntries, replyEntry, resolveEntry, taskText, type Target } from "./core";

const KNOWN_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function packageVersion(): string {
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const v = (JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as { version?: unknown }).version;
      if (typeof v === "string") return v;
    } catch {
      /* try the next place */
    }
  }
  return "0.0.0";
}

// ---------------------------------------------------------------------------------------------------------
// tools

const str = (description: string) => ({ type: "string", description });
const REF = str("Entry reference: <session>/PRO-n, or PRO-n when only one session has it.");

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (t: Target, args: Json) => Promise<string>;
}

class ParamError extends Error {}

function optString(a: Json, key: string): string | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ParamError(`'${key}' must be a string`);
  return v;
}
function reqString(a: Json, key: string): string {
  const v = optString(a, key);
  if (v === undefined || v.trim() === "") throw new ParamError(`'${key}' is required`);
  return v;
}

const TOOLS: Tool[] = [
  {
    name: "list_entries",
    description: "List review entries (one line each: ref, status, priority, title, source). All filters are optional.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "progress", "resolved"], description: "Only entries with this status." },
        priority: { type: "string", enum: ["blocking", "important", "minor"], description: "Only entries with this priority." },
        route: str("Only entries whose route matches this glob, e.g. /feeds/*."),
        session: str("Only this session (its id or the part after the date)."),
      },
      additionalProperties: false,
    },
    run: async (t, a) => {
      const rows = await listEntries(t, { status: optString(a, "status"), priority: optString(a, "priority"), route: optString(a, "route"), session: optString(a, "session") });
      return rows.length ? JSON.stringify(rows, null, 2) : "[]";
    },
  },
  {
    name: "show_entry",
    description: "Return the full markdown file of one entry.",
    inputSchema: { type: "object", properties: { ref: REF }, required: ["ref"], additionalProperties: false },
    run: async (t, a) => (await findEntry(t, reqString(a, "ref"))).markdown,
  },
  {
    name: "entry_task",
    description: "Return an agent-ready task for one entry: what to change, where, and how to resolve it.",
    inputSchema: { type: "object", properties: { ref: REF }, required: ["ref"], additionalProperties: false },
    run: (t, a) => taskText(t, reqString(a, "ref"), { closing: "mcp" }),
  },
  {
    name: "reply_entry",
    description: "Append a reply to the entry's '## Replies' section as '- <who> (<ISO date>): <text>'.",
    inputSchema: {
      type: "object",
      properties: { ref: REF, text: str("The reply."), who: str("Who is replying (default: agent).") },
      required: ["ref", "text"],
      additionalProperties: false,
    },
    run: async (t, a) => {
      const r = await replyEntry(t, reqString(a, "ref"), reqString(a, "text"), optString(a, "who"));
      return `replied to ${r.ref}\n${r.line}`;
    },
  },
  {
    name: "resolve_entry",
    description: "Mark an entry resolved, with an optional note written under '## Resolution'.",
    inputSchema: {
      type: "object",
      properties: {
        ref: REF,
        note: str("What was done."),
        requireTest: { type: "boolean", description: "Refuse unless the entry's test_plan names a test file that exists." },
      },
      required: ["ref"],
      additionalProperties: false,
    },
    run: async (t, a) => {
      const rt = a.requireTest;
      if (rt !== undefined && typeof rt !== "boolean") throw new ParamError("'requireTest' must be a boolean");
      const r = await resolveEntry(t, reqString(a, "ref"), { note: optString(a, "note"), requireTest: rt });
      return `resolved ${r.ref}`;
    },
  },
];

// ---------------------------------------------------------------------------------------------------------
// JSON-RPC

type Id = string | number | null;
const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** The response to one parsed message, or null when none is due (a notification). */
export async function handleMessage(t: Target, msg: unknown, version = packageVersion()): Promise<Json | null> {
  if (!isObj(msg) || typeof msg.method !== "string") {
    const id = isObj(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
    return fail(id, -32600, "Invalid Request");
  }
  // A notification (no id) never gets an answer, and is never acted on (a `tools/call` notification does not run).
  if (!("id" in msg)) return null;
  const id: Id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const params = msg.params;
  if (params !== undefined && !isObj(params)) return fail(id, -32602, "params must be an object");
  const p: Json = params ?? {};

  switch (msg.method) {
    case "initialize": {
      const v = typeof p.protocolVersion === "string" && KNOWN_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : "2025-06-18";
      return ok(id, { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "proompter", version } });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = typeof p.name === "string" ? TOOLS.find((x) => x.name === p.name) : undefined;
      if (!tool) return fail(id, -32602, typeof p.name === "string" ? `Unknown tool: ${p.name}` : "'name' is required");
      if (p.arguments !== undefined && !isObj(p.arguments)) {
        return ok(id, { content: [{ type: "text", text: "'arguments' must be an object" }], isError: true });
      }
      try {
        return ok(id, { content: [{ type: "text", text: await tool.run(t, (p.arguments as Json | undefined) ?? {}) }] });
      } catch (e) {
        // Bad arguments are a tool failure too, so the model sees the message and can retry.
        const text = e instanceof ParamError || e instanceof CliError ? e.message : `internal error: ${e instanceof Error ? e.message : String(e)}`;
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Serve until the input closes. */
export async function serveMcp(t: Target, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const send = (m: Json) => output.write(`${JSON.stringify(m)}\n`);
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      send(fail(null, -32700, "Parse error"));
      continue;
    }
    try {
      const r = await handleMessage(t, msg);
      if (r) send(r);
    } catch (e) {
      process.stderr.write(`proompter mcp: ${e instanceof Error ? e.message : String(e)}\n`);
      send(fail(isObj(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null, -32603, "Internal error"));
    }
  }
}
