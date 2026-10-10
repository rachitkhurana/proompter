/**
 * Source-stamping loader (DESIGN §4.1). Runs as a Turbopack loader (Next >= 15.3 `turbopack.rules`)
 * and as a webpack loader.
 *
 * - every intrinsic JSX element (lowercase tag, dashes allowed) gets `data-src="<path>:<line>:<col>"`
 *   (path: repo-relative, POSIX separators; line 1-based; col 1-based, pointing at the `<`)
 * - the root intrinsic element each PascalCase component returns gets `data-comp="<Name>"`
 *
 * Root rules (see `rootsOf`):
 * - `return <div/>`                      -> that div
 * - `return cond ? <a/> : <b/>`          -> both a and b
 * - `return cond && <a/>` (also || ??)   -> a
 * - `return <><div/></>`                 -> div (a fragment with exactly one element child)
 * - `return <><a/><b/></>`               -> nothing (no single root; a and b still get data-src)
 * - `return <Other/>`, `<motion.div/>`   -> nothing (the inner component stamps its own root)
 * - `return someVariable`                -> nothing (no data-flow analysis)
 * - every `return` in the component body counts; nested functions are separate scopes.
 *
 * Components recognised: `function Foo`, `const Foo = () => ...`, `const Foo = function ...`, those
 * wrapped in `memo` / `forwardRef` (also `React.memo`), and class components (`render()`).
 *
 * Never throws into the build: on a parse failure the source passes through untouched.
 */
import path from "node:path";
import type { parse } from "@babel/parser";
import type remapping from "@jridgewell/remapping";
import type MagicString from "magic-string";

/* ------------------------------------------------------------ lazy ESM deps */

// `@babel/parser` and `magic-string` are ESM-only. The CJS build of this loader reaches them through
// `import()` (esbuild turns it into `require()` there), so a Node without `require(esm)` fails at
// load time, inside `loadDeps`, where we can turn it into an actionable message.

export interface DepLoaders {
  parser: () => Promise<{ parse: typeof parse }>;
  magicString: () => Promise<{ default: typeof MagicString }>;
  remapping: () => Promise<{ default: typeof remapping }>;
}

interface Deps {
  parse: typeof parse;
  MagicString: typeof MagicString;
  remapping: typeof remapping;
}

const defaultLoaders: DepLoaders = {
  parser: () => import("@babel/parser"),
  magicString: () => import("magic-string"),
  remapping: () => import("@jridgewell/remapping"),
};

let loadedDeps: Deps | undefined;

/** Loads (once) the parser, magic-string and remapping. Pass `loaders` to substitute them (tests). */
export async function loadDeps(loaders?: DepLoaders): Promise<void> {
  if (!loaders && loadedDeps) return;
  const l = loaders ?? defaultLoaders;
  try {
    const [parser, ms, remap] = await Promise.all([l.parser(), l.magicString(), l.remapping()]);
    loadedDeps = { parse: parser.parse, MagicString: ms.default, remapping: remap.default };
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ERR_REQUIRE_ESM") {
      throw new Error(`@rachitkay/proompter/next needs Node 22.18 or newer (found ${process.version})`, {
        cause: error,
      });
    }
    throw error;
  }
}

function deps(): Deps {
  if (!loadedDeps) throw new Error("@rachitkay/proompter: call loadDeps() before stampSource()");
  return loadedDeps;
}

/* ------------------------------------------------------------------ types */

export interface LoaderOptions {
  /** Repo root that `data-src` paths are relative to. Defaults to webpack's rootContext, then cwd. */
  root?: string;
  /** Glob patterns (`*`, `**`, `?`) on the repo-relative path. Empty/undefined = everything. */
  include?: string[];
  /** Glob patterns (`*`, `**`, `?`) on the repo-relative path. */
  exclude?: string[];
}

export interface SourceMapObject {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: (string | null)[];
}

export interface StampResult {
  code: string;
  map: SourceMapObject;
}

export interface StampOptions {
  /** Incoming source map (from a previous loader). The output map is composed with it. */
  inputMap?: unknown;
  /** Name for the `sources` entry of the generated map. Defaults to `relPath`. */
  sourceName?: string;
}

/** The subset of the webpack / Turbopack loader context this loader uses. */
export interface LoaderContext {
  resourcePath: string;
  rootContext?: string;
  sourceMap?: boolean;
  async(): (error: Error | null, content?: string, map?: unknown) => void;
  getOptions?(): LoaderOptions;
  cacheable?(flag?: boolean): void;
}

/* -------------------------------------------------------------- AST helpers */

interface N {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number; column: number } };
  [key: string]: unknown;
}

const SKIP_KEYS = new Set([
  "loc",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
]);

const isNode = (v: unknown): v is N =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

const asNode = (v: unknown): N | undefined => (isNode(v) ? v : undefined);
const asNodes = (v: unknown): N[] => (Array.isArray(v) ? v.filter(isNode) : []);
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function children(node: N): N[] {
  const out: N[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) if (isNode(item)) out.push(item);
    } else if (isNode(v)) {
      out.push(v);
    }
  }
  return out;
}

function walk(node: N, visit: (n: N) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
/** Nodes whose `return`s belong to something other than the enclosing component. */
const SCOPE_TYPES = new Set([
  ...FUNCTION_TYPES,
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassDeclaration",
  "ClassExpression",
]);
const TRANSPARENT_TYPES = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);
const WRAPPER_CALLEES = new Set(["memo", "forwardRef"]);

function unwrap(node: N | undefined): N | undefined {
  let n = node;
  while (n && TRANSPARENT_TYPES.has(n.type)) n = asNode(n.expression);
  return n;
}

const isPascal = (name: string | undefined): name is string => !!name && /^[A-Z]/.test(name);

/** Lowercase-first JSXIdentifier: `div`, `svg`, `my-element`. Not `Foo`, `a.b`, or `a:b`. */
function intrinsicName(opening: N): string | undefined {
  const name = asNode(opening.name);
  if (!name || name.type !== "JSXIdentifier") return undefined;
  const value = asString(name.name);
  return value && /^[a-z]/.test(value) ? value : undefined;
}

function hasAttribute(opening: N, attr: string): boolean {
  return asNodes(opening.attributes).some((a) => {
    if (a.type !== "JSXAttribute") return false;
    const name = asNode(a.name);
    return name?.type === "JSXIdentifier" && name.name === attr;
  });
}

/** The returned expression(s) of a function, not descending into nested functions/classes. */
function collectReturns(fn: N): N[] {
  const body = asNode(fn.body);
  if (!body) return [];
  if (body.type !== "BlockStatement") return [body];
  const out: N[] = [];
  const visit = (n: N): void => {
    if (SCOPE_TYPES.has(n.type)) return;
    if (n.type === "ReturnStatement") {
      const arg = asNode(n.argument);
      if (arg) out.push(arg);
      return;
    }
    for (const c of children(n)) visit(c);
  };
  for (const stmt of asNodes(body.body)) visit(stmt);
  return out;
}

function isSignificantChild(c: N): boolean {
  if (c.type === "JSXText") return (asString(c.value) ?? "").trim() !== "";
  if (c.type === "JSXExpressionContainer") return asNode(c.expression)?.type !== "JSXEmptyExpression";
  return true;
}

/** Opening elements that are "the root" of a returned expression (see file header). */
function rootsOf(expr: N | undefined): N[] {
  const n = unwrap(expr);
  if (!n) return [];
  switch (n.type) {
    case "JSXElement": {
      const opening = asNode(n.openingElement);
      return opening && intrinsicName(opening) ? [opening] : [];
    }
    case "JSXFragment": {
      const significant = asNodes(n.children).filter(isSignificantChild);
      const only = significant.length === 1 ? significant[0] : undefined;
      return only && (only.type === "JSXElement" || only.type === "JSXFragment") ? rootsOf(only) : [];
    }
    case "ConditionalExpression":
      return [...rootsOf(asNode(n.consequent)), ...rootsOf(asNode(n.alternate))];
    case "LogicalExpression":
      return rootsOf(asNode(n.right));
    default:
      return [];
  }
}

function isWrapperCall(n: N): boolean {
  if (n.type !== "CallExpression") return false;
  const callee = asNode(n.callee);
  if (callee?.type === "Identifier") return WRAPPER_CALLEES.has(asString(callee.name) ?? "");
  if (callee?.type === "MemberExpression") {
    const prop = asNode(callee.property);
    return prop?.type === "Identifier" && WRAPPER_CALLEES.has(asString(prop.name) ?? "");
  }
  return false;
}

/** `() => ...`, `function () {}`, or either wrapped in memo/forwardRef (nested too). */
function componentFunction(init: N | undefined): N | undefined {
  const n = unwrap(init);
  if (!n) return undefined;
  if (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression") return n;
  if (isWrapperCall(n)) return componentFunction(asNodes(n.arguments)[0]);
  return undefined;
}

/* ------------------------------------------------------------------ stamping */

const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const hasUseServer = (program: N): boolean =>
  asNodes(program.directives).some((d) => asString(asNode(d.value)?.value) === "use server");

type ParserPlugins = NonNullable<NonNullable<Parameters<typeof parse>[1]>["plugins"]>;

/**
 * Decorator flavours, tried in order until one parses. Legacy (tsc `experimentalDecorators`) is by far
 * the most common in Next apps; `decorators` is the TC39 flavour; the last entry has no decorator
 * support at all (a file that fails everything is passed through untouched).
 */
const DECORATOR_ATTEMPTS: ParserPlugins[] = [
  ["decorators-legacy", "decoratorAutoAccessors"],
  ["decorators-legacy"],
  ["decorators", "decoratorAutoAccessors"],
  [],
];

function parseSource(code: string, typescript: boolean): N | undefined {
  const base: ParserPlugins = typescript ? ["jsx", "typescript"] : ["jsx"];
  const { parse: parseCode } = deps(); // outside the try: "not loaded" must not look like a parse error
  for (const extra of DECORATOR_ATTEMPTS) {
    try {
      const file = parseCode(code, {
        sourceType: "module",
        // Babel 8 creates ParenthesizedExpression nodes by default; we don't want them (we also
        // unwrap them defensively in `unwrap`).
        createParenthesizedExpressions: false,
        plugins: [...base, ...extra],
      }) as unknown as N;
      return asNode(file.program);
    } catch {
      // try the next decorator flavour
    }
  }
  return undefined;
}

/** `@react-three/fiber` / `drei` treat `data-*` props as nested paths (`obj.data.src`) and can throw. */
const R3F_IMPORT = /^@react-three\/(fiber|drei)(\/|$)/;

function importsReactThree(program: N): boolean {
  return asNodes(program.body).some(
    (stmt) =>
      stmt.type === "ImportDeclaration" && R3F_IMPORT.test(asString(asNode(stmt.source)?.value) ?? ""),
  );
}

/**
 * Pure transform. `relPath` is the repo-relative POSIX path written into `data-src` (a `.jsx`
 * suffix parses without the TypeScript plugin). Returns `null` when the file is skipped
 * ("use server"), unparsable, or has nothing to stamp.
 */
export function stampSource(code: string, relPath: string, options: StampOptions = {}): StampResult | null {
  if (!code.includes("<")) return null;
  const program = parseSource(code, !/\.jsx$/.test(relPath));
  if (!program || hasUseServer(program) || importsReactThree(program)) return null;

  const openings: N[] = [];
  const compByOpening = new Map<number, string>();
  const handled = new Set<number>();

  const addComponent = (fn: N | undefined, name: string | undefined): void => {
    if (!fn || !isPascal(name) || handled.has(fn.start)) return;
    handled.add(fn.start);
    for (const ret of collectReturns(fn)) {
      for (const root of rootsOf(ret)) if (!compByOpening.has(root.start)) compByOpening.set(root.start, name);
    }
  };

  walk(program, (n) => {
    switch (n.type) {
      case "JSXOpeningElement":
        openings.push(n);
        break;
      case "FunctionDeclaration":
        addComponent(n, asString(asNode(n.id)?.name));
        break;
      case "VariableDeclarator": {
        const id = asNode(n.id);
        if (id?.type === "Identifier") addComponent(componentFunction(asNode(n.init)), asString(id.name));
        break;
      }
      case "CallExpression": {
        // `export default memo(function Foo() {...})`: take the name from the function itself.
        if (!isWrapperCall(n)) break;
        const fn = componentFunction(n);
        addComponent(fn, asString(asNode(fn?.id)?.name));
        break;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const render = asNodes(asNode(n.body)?.body).find(
          (m) => m.type === "ClassMethod" && asString(asNode(m.key)?.name) === "render",
        );
        addComponent(render, asString(asNode(n.id)?.name));
        break;
      }
    }
  });

  const s = new (deps().MagicString)(code);
  let changed = false;
  for (const opening of openings) {
    if (!intrinsicName(opening)) continue;
    let insert = "";
    if (!hasAttribute(opening, "data-src")) {
      const { line, column } = opening.loc.start;
      insert += ` data-src="${escapeAttr(`${relPath}:${line}:${column + 1}`)}"`;
    }
    const comp = compByOpening.get(opening.start);
    if (comp && !hasAttribute(opening, "data-comp")) insert += ` data-comp="${comp}"`;
    if (!insert) continue;
    const nameNode = asNode(opening.name);
    if (!nameNode) continue;
    // Right after the tag name: explicit attributes and spreads written by the user come later in
    // the attribute list, so `<div {...props}>` lets props override the stamp.
    s.appendLeft(nameNode.end, insert);
    changed = true;
  }
  if (!changed) return null;

  const sourceName = options.sourceName ?? relPath;
  const own = JSON.parse(
    s.generateMap({ hires: true, source: sourceName, includeContent: true }).toString(),
  ) as SourceMapObject;
  return { code: s.toString(), map: composeMaps(own, options.inputMap) };
}

function parseMap(map: unknown): SourceMapObject | undefined {
  if (!map) return undefined;
  if (typeof map === "string") {
    try {
      return JSON.parse(map) as SourceMapObject;
    } catch {
      return undefined;
    }
  }
  return typeof map === "object" ? (map as SourceMapObject) : undefined;
}

/** `own` maps output -> loader input; `inputMap` maps loader input -> the real original. */
function composeMaps(own: SourceMapObject, inputMap: unknown): SourceMapObject {
  const incoming = parseMap(inputMap);
  if (!incoming) return own;
  type Input = Parameters<Deps["remapping"]>[0];
  const composed = deps().remapping([own, incoming] as unknown as Input, () => null);
  return JSON.parse(composed.toString()) as SourceMapObject;
}

/* ----------------------------------------------------------- file selection */

/**
 * Glob syntax, matched against the whole repo-relative POSIX path:
 * - `*` (no slash), `**` (anything, incl. slashes), `?` (one non-slash char)
 * - `{a,b}` alternation, e.g. `app/**\/*.{tsx,jsx}`
 * - a pattern whose last segment has no `*`/`?` also matches everything beneath it, so a bare
 *   directory works: `exclude: ["app/admin"]` matches `app/admin/page.tsx` (like `app/admin/**`).
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/^\.\//, "").replace(/\/+$/, "");
  // Braces are alternation only when balanced; otherwise they are literal.
  let balance = 0;
  let balanced = true;
  for (const ch of g) {
    if (ch === "{") balance++;
    else if (ch === "}" && --balance < 0) balanced = false;
  }
  balanced = balanced && balance === 0;
  let depth = 0;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i);
    if (balanced && c === "{") {
      depth++;
      re += "(?:";
    } else if (balanced && c === "}") {
      depth--;
      re += ")";
    } else if (balanced && c === "," && depth > 0) {
      re += "|";
    } else if (c === "*") {
      if (g.charAt(i + 1) === "*") {
        i++;
        if (g.charAt(i + 1) === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const lastSegment = g.slice(g.lastIndexOf("/") + 1);
  const dirLike = !/[*?]/.test(lastSegment);
  return new RegExp(`^${re}${dirLike ? "(?:/.*)?" : ""}$`);
}

/** Should this repo-relative POSIX path be stamped? */
export function shouldStamp(relPath: string, options: Pick<LoaderOptions, "include" | "exclude"> = {}): boolean {
  if (!/\.(tsx|jsx)$/.test(relPath)) return false;
  if (/(^|\/)(node_modules|\.next)\//.test(relPath)) return false;
  if (/\.(stories|test|spec)\.[cm]?[jt]sx?$/.test(relPath)) return false;
  const { include, exclude } = options;
  if (include?.length && !include.some((g) => globToRegExp(g).test(relPath))) return false;
  if (exclude?.some((g) => globToRegExp(g).test(relPath))) return false;
  return true;
}

export function toRepoRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/* -------------------------------------------------------------------- loader */

function readOptions(ctx: LoaderContext): LoaderOptions {
  return ctx.getOptions?.() ?? {};
}

/** Never throws: stamping is a dev aid and must not fail the host's build. */
function transformFile(ctx: LoaderContext, source: string, inputMap: unknown): { code: string; map: unknown } {
  const code = String(source);
  try {
    const options = readOptions(ctx);
    const root = options.root ?? ctx.rootContext ?? process.cwd();
    const relPath = toRepoRelative(root, ctx.resourcePath);
    if (!shouldStamp(relPath, options)) return { code, map: inputMap };
    const result = stampSource(code, relPath, { inputMap, sourceName: ctx.resourcePath });
    if (!result) return { code, map: inputMap };
    return { code: result.code, map: ctx.sourceMap === false ? undefined : result.map };
  } catch {
    return { code, map: inputMap };
  }
}

export default function proompterLoader(this: LoaderContext, source: string, inputMap?: unknown): void {
  const callback = this.async();
  this.cacheable?.();
  const finish = (): void => {
    const { code, map } = transformFile(this, source, inputMap);
    callback(null, code, map); // exactly once; if it throws, that error belongs to the caller
  };
  if (loadedDeps) return finish(); // sync path: a throwing callback propagates to the loader runner
  loadDeps().then(
    () => {
      try {
        finish();
      } catch (error) {
        console.error("[proompter] loader callback threw:", error);
      }
    },
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
  );
}
