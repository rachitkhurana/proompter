# T16: MCP server (DESIGN D20)

**Goal:** an MCP client (Claude Code, etc.) lists, reads, replies to and resolves entries.

**Owns:**
- `src/cli/mcp.ts`
- `src/cli/index.ts` (the `mcp` subcommand only)
- `test/cli/mcp.test.ts`
- README "MCP" section

## Protocol
Hand-written JSON-RPC 2.0 over stdio, newline-delimited, with no dependency.
- **`initialize`:**
  - Answers `protocolVersion`: echo the client's when it is a known one, else "2025-06-18".
  - `capabilities: { tools: {} }`, `serverInfo: { name: "proompter", version }`.
- **`notifications/initialized`:** ignored.
- **`tools/list`:** each tool has a JSON Schema `inputSchema`.
- **`tools/call`:** answers `{ content: [{ type: "text", text }], isError? }`.
- **`ping`:** supported.
- **Unknown methods:** error `-32601`.
- **Errors:** never crash on bad input. stdout carries only protocol messages; logs go to stderr.

## Tools (thin wrappers over `src/cli/core.ts`)
- `list_entries { status?, priority?, route?, session? }`
- `show_entry { ref }`
- `entry_task { ref }`
- `reply_entry { ref, text, who? }`: appends to a `## Replies` section, which the serializer must round-trip.
  Extend `serialize`/`parse` minimally if needed, with round-trip tests, and report it. It also adds an activity
  line.
- `resolve_entry { ref, note?, requireTest? }`

## Tests
Spawn `node dist/cli/index.js mcp` with a temp `--dir`. Send initialize, tools/list, then each tool, and assert
the responses. Also test a malformed line and an unknown method.

## Docs
README "MCP": the Claude Code config snippet (`claude mcp add proompter -- npx proompter mcp`) and the tool list.
