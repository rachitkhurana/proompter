/**
 * The GitHub issue body (DESIGN D16): what a person reads in the issue, not the entry file. Note and screenshots
 * first, a field table, the rest folded into `<details>`, and a hidden `ref` line so the issue can be found again.
 * Stable across syncs: it carries no issue number, status, `updated` or activity.
 */
import type { Entry, Session } from "../core/entry";
import { assetNames, entryPath, escapeSections, fileProjection } from "../core/serialize";

export interface IssueBodyOptions {
  /** `owner/name`. */
  repo: string;
  /** The branch the PNGs are on (the assets branch in `save: "github"`, else the reviews branch). */
  branch: string;
  /** `save: "github"`: there is no entry file to point at. */
  github: boolean;
  /** The entry has an element crop / a full-viewport PNG. */
  element: boolean;
  viewport: boolean;
  /** Cap on the whole body; the visible part is cut to fit and the ref line is kept. */
  max: number;
}

/** The hidden last line. `refOf` also accepts the frontmatter `ref:` line of 0.1.x and 0.2.0 bodies. */
export const refComment = (ref: string) => `<!-- proompter ref: ${ref} -->`;

/** Issue text is shown to people: break `@user` and `@org/team` so a synced entry cannot ping anyone. */
export const defang = (t: string) => t.replace(/@/g, "@\u200b");
/** One line, with a fence longer than any backtick run inside, so the value cannot end the span. */
const code = (s: string) => {
  const v = s.replace(/\s+/g, " ").trim();
  const fence = "`".repeat(Math.max(0, ...(v.match(/`+/g) ?? []).map((m) => m.length)) + 1);
  const pad = v.startsWith("`") || v.endsWith("`") ? " " : "";
  return `${fence}${pad}${v}${pad}${fence}`;
};
/** Table cell values: `|` always, and for plain text the backslash first, so `\|` cannot cancel the escape. */
const codeCell = (s: string) => code(s).replace(/\|/g, "\\|");
const textCell = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const lines = (s: string) => escapeSections(s.split("\n")).join("\n");

export function issueBody(session: Session, entry: Entry, o: IssueBodyOptions): string {
  const e = fileProjection(entry, session);
  const t = e.targets[0];
  const names = assetNames(e.n, e.viewport);
  const url = (file: string) => `https://github.com/${o.repo}/blob/${o.branch}/reviews/${session.id}/assets/${file}?raw=true`;
  const blocks: string[] = [];

  if (e.kind === "text") blocks.push((e.quote ?? "").split("\n").map((l) => (l === "" ? ">" : `> ${l}`)).join("\n"));
  if (e.description) blocks.push(lines(e.description));
  const images = [
    ...(o.element ? [`![element](${url(names.element)})`] : []),
    ...(o.viewport ? [`![${e.viewport} viewport](${url(names.viewport)})`] : []),
  ];
  if (images.length) blocks.push(images.join("\n\n"));

  const rows: [string, string][] = [
    ["Source", t?.source ? `${codeCell(t.source)}${t.sourceInherited ? " (inherited)" : ""}` : "none"],
    ["Route", codeCell(e.route)],
    ["Viewport", `${e.viewport} ${e.size.width}x${e.size.height}`],
  ];
  if (t?.component) rows.push(["Component", codeCell(t.component)]);
  rows.push(["Intent", e.intent]);
  if (e.tags.length) rows.push(["Tags", textCell(e.tags.join(", "))]);
  if (e.task !== undefined) rows.push(["Task", textCell(e.task)]);
  if (e.testPlan !== undefined) rows.push(["Test plan", textCell(e.testPlan)]);
  for (const [k, v] of Object.entries(e.extra ?? {})) rows.push([textCell(k), textCell(typeof v === "string" ? v : JSON.stringify(v))]);
  blocks.push(["| Field | Value |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n"));

  if ((e.kind === "multi" || e.kind === "box") && e.targets.length) {
    const list = e.targets.map((x, i) => `${i + 1}. ${x.label.replace(/\s+/g, " ")}: ${x.source ? code(x.source) + (x.sourceInherited ? " (inherited)" : "") : "no source"}, ${code(x.selector)}, ${code(x.component)}`);
    blocks.push(["### Targets", "", ...list].join("\n"));
  }
  if (e.resolution) blocks.push(`### Resolution\n\n${lines(e.resolution)}`);
  if (e.replies) blocks.push(`### Replies\n\n${lines(e.replies)}`);

  const s = e.context.summary!;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const details = ["<details><summary>Details</summary>", ""];
  if (!o.github) details.push(`File: ${code(`reviews/${session.id}/${entryPath(e)}`)} on ${code(o.branch)}`, "");
  if (t) details.push(`Selector: ${code(t.selector)}`, "");
  details.push(`- Console: ${n(s.consoleLines, "line", "lines")}, ${n(s.consoleErrors, "error", "errors")}`);
  for (const item of s.consoleItems) details.push(`  - ${item}`);
  details.push(`- Network: ${s.networkFailed} failed of ${s.networkTotal}`);
  for (const item of s.networkItems) details.push(`  - ${item}`);
  if (e.context.build) details.push(`- Build: ${e.context.build}`);
  details.push("", `Session: ${code(session.id)}, reviewer: ${session.reviewer}, created: ${e.created}`, "", "</details>");
  blocks.push(details.join("\n"));

  const tail = `\n\n${refComment(`${e.session}/${e.id}`)}`;
  const visible = defang(blocks.join("\n\n"));
  const note = o.github ? "(truncated)" : "(truncated, see the file on the branch)";
  if (visible.length + tail.length <= o.max) return `${visible}${tail}`;
  let cut = visible.slice(0, Math.max(0, o.max - tail.length - note.length - 2));
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // not half of a surrogate pair
  return `${cut}\n\n${note}${tail}`;
}
