import { describe, expect, it } from "vitest";
import { makeEntry, makeSession } from "../../src/core/entry-fixtures.test-util";
import { issueBody, type IssueBodyOptions } from "../../src/github/issue-body";

const SID = "2026-10-10_manual-test-pass";
const o = (over: Partial<IssueBodyOptions> = {}): IssueBodyOptions => ({ repo: "acme/reviews", branch: "reviews", github: false, element: true, viewport: true, max: 60_000, ...over });
const body = (entry = makeEntry(), over: Partial<IssueBodyOptions> = {}) => issueBody(makeSession(), entry, o(over));

describe("issueBody", () => {
  it("has no relative links, no frontmatter and no stale fields", () => {
    const b = body();
    expect(b).not.toContain("../assets");
    expect(b.startsWith("---")).toBe(false);
    expect(b).not.toMatch(/^(issue|status|updated):/m);
    expect(b).not.toMatch(/^---$/m);
  });

  it("links both images absolutely, on the target branch", () => {
    for (const [branch, github] of [["reviews", false], ["proompter-assets", true]] as const) {
      const b = body(makeEntry(), { branch, github });
      const root = `https://github.com/acme/reviews/blob/${branch}/reviews/${SID}/assets`;
      expect(b).toContain(`![element](${root}/005-mobile.png?raw=true)`);
      expect(b).toContain(`![mobile viewport](${root}/005-mobile-full.png?raw=true)`);
      expect(b.indexOf("![element]")).toBeLessThan(b.indexOf("![mobile viewport]"));
    }
  });

  it("has no image lines for an entry without a snapshot", () => {
    const b = body(makeEntry({ snapshot: undefined }), { element: false, viewport: false });
    expect(b).not.toContain("![");
    expect(body(makeEntry(), { element: false })).not.toContain("![element]");
  });

  it("has the field table", () => {
    const b = body();
    expect(b).toContain("| Field | Value |");
    expect(b).toMatch(/\| Source \| `[^`]+` \(inherited\) \|/);
    expect(b).toContain("| Route | `/feeds` |");
    expect(b).toContain("| Viewport | mobile 390x844 |");
    expect(b).toContain("| Component | `FeedPage \u203a FeedList \u203a PostCard \u203a PostHeader \u203a Avatar` |");
    expect(b).toContain("| Intent | fix |");
    expect(b).toContain("| Task | T-feed-home |");
    expect(b).toContain("| Test plan | \u00a72 Feed and posts |");
    expect(body(makeEntry({ task: undefined, testPlan: undefined, target: undefined, targets: [], kind: "note" }))).not.toMatch(/\| (Task|Test plan) \|/);
  });

  it("escapes pipes and newlines in table values", () => {
    const b = body(makeEntry({ task: "a | b\nc" }));
    expect(b).toContain("| Task | a \\| b c |");
    expect(body(makeEntry({ task: "a\\|b" }))).toContain("| Task | a\\\\\\|b |");
  });

  it("folds the details, and points at the file only when files are saved", () => {
    const b = body();
    expect(b).toContain("<details><summary>Details</summary>\n\n");
    expect(b).toContain("- Console: ");
    expect(b).toContain("- Network: ");
    expect(b).toContain("- Build: migrate/main@\u200b611df0b");
    expect(b).toContain(`Session: \`${SID}\``);
    expect(b).toContain("</details>");
    expect(b).toContain(`File: \`reviews/${SID}/entries/005-avatar-is-cropped-on-mobile.md\` on \`reviews\``);
    expect(body(makeEntry(), { github: true, branch: "proompter-assets" })).not.toContain("File:");
  });

  it("ends with the hidden ref", () => {
    const b = body();
    expect(b.split("\n").pop()).toBe(`<!-- proompter ref: ${SID}/PRO-5 -->`);
  });

  it("quotes text selections and lists multi targets", () => {
    const t = makeEntry().targets[0]!;
    const text = body(makeEntry({ kind: "text", quote: "line one\n\nline two" }));
    expect(text).toContain("> line one\n>\n> line two");
    const multi = body(makeEntry({ kind: "multi", targets: [t, { ...t, label: "Second" }] }));
    expect(multi).toContain("### Targets");
    expect(multi).toMatch(/\n1\. Avatar: /);
    expect(multi).toMatch(/\n2\. Second: /);
  });

  it("keeps the Resolution and Replies sections", () => {
    const b = body(makeEntry({ resolution: "Fixed in abc.", replies: "- agent (2026-10-11): ok" }));
    expect(b).toContain("### Resolution\n\nFixed in abc.");
    expect(b).toContain("### Replies\n\n- agent (2026-10-11): ok");
  });

  it("truncates the visible part but always keeps the ref", () => {
    const b = body(makeEntry({ description: "x".repeat(5000) }), { max: 1500 });
    expect(b.length).toBeLessThanOrEqual(1500);
    expect(b).toContain("(truncated, see the file on the branch)");
    expect(b.split("\n").pop()).toBe(`<!-- proompter ref: ${SID}/PRO-5 -->`);
    expect(body(makeEntry({ description: "x".repeat(5000) }), { max: 1500, github: true })).toContain("(truncated)");
  });

  it("is stable: the issue number, status and activity do not change it", () => {
    expect(body(makeEntry({ issue: "7", status: "resolved", updated: "2027-01-01T00:00:00Z", activity: [] }))).toBe(body(makeEntry()));
  });

  it("keeps a hostile selector on one line inside its code span", () => {
    const t = makeEntry().targets[0]!;
    const b = body(makeEntry({ targets: [{ ...t, selector: "a\n</details> <!-- `x` ``" }], target: { ...t, selector: "a\n</details> <!-- `x` ``" } }));
    const line = b.split("\n").find((l) => l.startsWith("Selector: "))!;
    expect(line).toBe("Selector: ``` a </details> <!-- `x` `` ```");
    expect(b.match(/<\/details>/g)).toHaveLength(2);
    expect(b.split("\n").pop()).toBe(`<!-- proompter ref: ${SID}/PRO-5 -->`);
  });

  it("has a Tags row only when there are tags", () => {
    expect(body()).toContain("| Tags | ui |");
    expect(body(makeEntry({ tags: [] }))).not.toContain("| Tags |");
  });

  it("defangs @ before the cap and never splits a surrogate pair", () => {
    const b = body(makeEntry({ description: "@".repeat(5000) }), { max: 2000 });
    expect(b.length).toBeLessThanOrEqual(2000);
    expect(b).not.toMatch(/@(?!\u200b)/);
    for (let max = 1500; max < 1506; max++) {
      const e = body(makeEntry({ description: "\u{1F600}".repeat(2000) }), { max });
      expect(e.length).toBeLessThanOrEqual(max);
      expect(e).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });
});
