/**
 * `@rachitkay/proompter/vite`: the Vite counterpart of `withProompter` plus the dev route (D14).
 *
 * ```ts
 * // vite.config.ts
 * import react from "@vitejs/plugin-react";
 * import { proompter } from "@rachitkay/proompter/vite";
 * export default defineConfig({ plugins: [proompter(), react()] });
 * ```
 *
 * - Flag: `VITE_PROOMPTER=true` (shell or `.env*`), or `proompter({ enabled })`.
 * - Defines `import.meta.env.VITE_PROOMPTER` ("true" or "") from the plugin's own decision, so the app's flag check
 *   and the stamping always agree (`proompter({ enabled: true })` needs no env var). Off, the check is a build-time
 *   `false` and the kit's dynamic import is dropped (e2e/vite.spec.ts checks the built files).
 * - On: stamps `data-src` on the app's .tsx/.jsx (never node_modules), before any JSX transform, and serves
 *   the file writer at `/api/proompter` on the dev server only. `vite build` and `vite preview` have no route.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { loadEnv, type Plugin } from "vite";
import { loadDeps, shouldStamp, stampSource, toRepoRelative } from "../next/loader";
import { createProompterRoute } from "../next/route";
import { findRepoRoot } from "../next/with-proompter";

export interface ProompterViteOptions {
  /** Default: `VITE_PROOMPTER === "true"`, from the shell or Vite's `.env*` files for the current mode. */
  enabled?: boolean;
  /** Same globs as `withProompter`: repo-relative paths to stamp (default: every .tsx/.jsx). */
  include?: string[];
  /** Same globs as `withProompter`: repo-relative paths never to stamp. */
  exclude?: string[];
  /** Root that `data-src` paths are relative to. Default: the nearest ancestor of `process.cwd()` with `.git`. */
  root?: string;
  /** Extra host names (no port) that may reach the dev route, e.g. a LAN name. Loopback is always allowed. */
  allowedHosts?: string[];
}

const ENDPOINT = "/api/proompter";
const JSX_FILE = /\.(tsx|jsx)$/;

export function proompter(options: ProompterViteOptions = {}): Plugin {
  let enabled = false;
  const root = options.root ?? findRepoRoot(process.cwd());

  return {
    name: "proompter",
    enforce: "pre", // stamp the untouched source, before the React plugin compiles JSX
    config(config, env) {
      const fileEnv = loadEnv(env.mode, config.envDir || config.root || process.cwd(), "VITE_");
      enabled = options.enabled ?? fileEnv.VITE_PROOMPTER === "true";
      return { define: { "import.meta.env.VITE_PROOMPTER": JSON.stringify(enabled ? "true" : "") } };
    },
    async transform(code, id) {
      if (!enabled) return null;
      const file = id.split("?")[0]!;
      if (!JSX_FILE.test(file) || file.includes("/node_modules/")) return null;
      const rel = toRepoRelative(root, file);
      if (!shouldStamp(rel, options)) return null;
      await loadDeps();
      const result = stampSource(code, rel, { sourceName: file });
      return result ? { code: result.code, map: result.map } : null;
    },
    configureServer(server) {
      if (!enabled) return;
      const route = createProompterRoute({ allowedHosts: options.allowedHosts, enabled: () => true });
      server.middlewares.use(ENDPOINT, (req, res, next) => {
        const handler = req.method === "GET" ? route.GET : req.method === "POST" ? route.POST : null;
        if (!handler) return next();
        handler(toRequest(req)).then(
          (response) => send(res, response),
          (error: unknown) => next(error),
        );
      });
    },
  };
}

/** Node request (Connect strips the mount path from `url`, not from `originalUrl`) -> Fetch `Request`. */
function toRequest(req: IncomingMessage & { originalUrl?: string }): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  const url = new URL(req.originalUrl ?? req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
