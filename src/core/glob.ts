// Pure (no node imports): shared by the build-time loader and the client-side repo plugin.
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
