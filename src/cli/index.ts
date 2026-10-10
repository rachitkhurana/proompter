import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { serveMcp } from "./mcp";
import { CliError, findEntry, listEntries, listLine, resolveEntry, targetFor, taskText } from "./core";

const USAGE = `proompter: work the reviews/ folder from the terminal

Usage:
  proompter list [--status open|progress|resolved] [--priority blocking|important|minor]
                 [--route <glob>] [--session <id>] [--json]
  proompter show <ref> [--json]
  proompter task <ref>
  proompter resolve <ref> [--note "<text>"] [--require-test]
  proompter mcp          serve the same actions to an MCP client over stdio

Options:
  --dir <path>   the reviews folder (default ./reviews)
  -h, --help

<ref> is <session>/PRO-n, or PRO-n when only one session has it.
Exit codes: 0 ok, 1 not found, 2 usage or ambiguous, 3 unexpected error.
`;

async function run(argv: string[]): Promise<string> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      route: { type: "string" },
      session: { type: "string" },
      note: { type: "string" },
      json: { type: "boolean" },
      "require-test": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ref, ...extra] = positionals;
  if (values.help || cmd === undefined) return USAGE;
  if (extra.length) throw new CliError(`unexpected argument '${extra[0]}'`);
  const t = targetFor(process.cwd(), values.dir);
  if (values.dir !== undefined && !existsSync(t.dir)) throw new CliError(`--dir ${t.dir} does not exist`, 2);
  const needRef = (): string => {
    if (ref === undefined) throw new CliError(`'${cmd}' needs an entry reference`);
    return ref;
  };
  switch (cmd) {
    case "list": {
      if (ref !== undefined) throw new CliError(`unexpected argument '${ref}'`);
      const rows = await listEntries(t, values);
      if (values.json) return `${JSON.stringify(rows, null, 2)}\n`;
      return rows.length ? `${rows.map(listLine).join("\n")}\n` : "";
    }
    case "show": {
      const x = await findEntry(t, needRef());
      return values.json ? `${JSON.stringify(x.entry, null, 2)}\n` : x.markdown;
    }
    case "task":
      return taskText(t, needRef());
    case "resolve": {
      const r = await resolveEntry(t, needRef(), { note: values.note, requireTest: values["require-test"] });
      return `resolved ${r.ref}\n`;
    }
    case "mcp":
      if (ref !== undefined) throw new CliError(`unexpected argument '${ref}'`);
      await serveMcp(t);
      return "";
    default:
      throw new CliError(`unknown command '${cmd}'\n\n${USAGE}`);
  }
}

try {
  process.stdout.write(await run(process.argv.slice(2)));
} catch (e) {
  if (e instanceof CliError) {
    process.stderr.write(`proompter: ${e.message}\n`);
    process.exitCode = e.code;
  } else if (e instanceof TypeError && (e as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
    process.stderr.write(`proompter: ${e.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`proompter: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 3;
  }
}
