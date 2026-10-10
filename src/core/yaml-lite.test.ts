import { describe, expect, it } from "vitest";
import { emitString, emitValue, parseFrontmatter, parseValue, YamlError } from "./yaml-lite";

/** emit then parse must give the string back, whatever it is. */
const roundTrip = (s: string, opts?: Parameters<typeof emitString>[1]) => parseValue(emitString(s, opts));

describe("emitString", () => {
  it("leaves ordinary text, paths and file:line:col plain", () => {
    for (const s of [
      "open",
      "/feeds",
      "src/app/(app)/feeds/_components/post-card.tsx:48:7",
      "FeedPage › FeedList › Avatar",
      "§2 Feed and posts",
      "mobile 390x844",
      "2026-10-10_manual-test-pass",
      "T-feed-home",
      "PRO-5",
    ]) {
      expect(emitString(s)).toBe(s);
    }
  });

  it("quotes what a stricter YAML parser would read differently", () => {
    expect(emitString("")).toBe("''");
    expect(emitString(" lead")).toBe("' lead'");
    expect(emitString("trail ")).toBe("'trail '");
    expect(emitString("a: b")).toBe("'a: b'");
    expect(emitString("a #b")).toBe("'a #b'");
    expect(emitString("ends:")).toBe("'ends:'");
    expect(emitString("#481")).toBe("'#481'");
    expect(emitString("- item")).toBe("'- item'");
    expect(emitString("-")).toBe("'-'");
    expect(emitString("? q")).toBe("'? q'");
    expect(emitString("[x]")).toBe("'[x]'");
    expect(emitString("{x}")).toBe("'{x}'");
    expect(emitString("*alias")).toBe("'*alias'");
    expect(emitString("&anchor")).toBe("'&anchor'");
    expect(emitString("!tag")).toBe("'!tag'");
    expect(emitString("|")).toBe("'|'");
    expect(emitString(">")).toBe("'>'");
    expect(emitString("%x")).toBe("'%x'");
    expect(emitString("@x")).toBe("'@x'");
    expect(emitString("`x")).toBe("'`x'");
    expect(emitString("---")).toBe("'---'");
    expect(emitString("it's")).toBe("it's"); // inside a plain scalar an apostrophe is fine
    expect(emitString("'q'")).toBe("'''q'''");
    expect(emitString('"q"')).toBe(`'"q"'`);
  });

  it("quotes words and numbers YAML would type", () => {
    for (const s of ["null", "~", "true", "False", "yes", "No", "on", "OFF", "y", "N", "5", "-5", "1.5", "1e3", "0x1f", ".inf", "2026-10-10", "2026-10-10T12:42:07Z"]) {
      expect(emitString(s)).toBe(`'${s}'`);
      expect(roundTrip(s)).toBe(s);
    }
  });

  it("goes double-quoted (JSON style) for line breaks and control characters", () => {
    expect(emitString("a\u2028b")).toBe('"a\u2028b"');
    expect(emitString("tab\there")).toBe('"tab\\there"');
    expect(roundTrip("a\nb\r\nc")).toBe("a\nb\r\nc");
    expect(roundTrip('say "hi"\n\\o/')).toBe('say "hi"\n\\o/');
    expect(roundTrip("\u0000\u001f\u007f")).toBe("\u0000\u001f\u007f");
  });

  it("can force single quotes (selectors)", () => {
    expect(emitString("div > p", { quote: true })).toBe("'div > p'");
    expect(emitString('[data-src="a"]', { quote: true })).toBe(`'[data-src="a"]'`);
  });

  it("round-trips awkward strings", () => {
    for (const s of ["", " ", "a  b", "'", "''", "\"'\"", "a'b", "x # y", "x#y", "k: v: w", "[a, b]", "emoji 🎯 ok", "日本語", "line1 \\ line2", "back\\slash", "# not a comment", "- dash", "a,b", "a]b"]) {
      expect(roundTrip(s)).toBe(s);
      expect(roundTrip(s, { flow: true })).toBe(s);
      expect(roundTrip(s, { quote: true })).toBe(s);
    }
  });
});

describe("flow lists", () => {
  it("emits and parses tags", () => {
    expect(emitValue(["ui"])).toBe("[ui]");
    expect(emitValue([])).toBe("[]");
    expect(emitValue(["ui", "data", "needs review"])).toBe("[ui, data, needs review]");
    expect(parseValue("[ui, data,  copy ]")).toEqual(["ui", "data", "copy"]);
    expect(parseValue("[]")).toEqual([]);
  });

  it("quotes items that contain flow punctuation, and round-trips them", () => {
    const tags = ["a,b", "c]d", "e[f", "{g}", "h: i", "it's", '"q"', "", " sp ", "null", "5"];
    expect(parseValue(emitValue(tags))).toEqual(tags);
    expect(emitValue(["a,b"])).toBe("['a,b']");
  });

  it("tolerates a trailing comment and rejects junk", () => {
    expect(parseValue("[a, b] # tags")).toEqual(["a", "b"]);
    expect(() => parseValue("[a, b")).toThrow(YamlError);
    expect(() => parseValue("[a b] x")).toThrow(YamlError);
  });
});

describe("parseValue", () => {
  it("reads plain, single and double quoted scalars", () => {
    expect(parseValue("open")).toBe("open");
    expect(parseValue("  open  ")).toBe("open");
    expect(parseValue("'it''s'")).toBe("it's");
    expect(parseValue('"a\\tb"')).toBe("a\tb");
    expect(parseValue('"\\u00e9"')).toBe("é");
  });

  it("strips trailing comments but not '#' inside values", () => {
    expect(parseValue("open            # open | progress | resolved")).toBe("open");
    expect(parseValue("'a #b' # note")).toBe("a #b");
    expect(parseValue('"a #b" # note')).toBe("a #b");
    expect(parseValue("src/a.tsx:1:2#frag")).toBe("src/a.tsx:1:2#frag");
  });

  it("types only when asked", () => {
    expect(parseValue("null")).toBeNull();
    expect(parseValue("~")).toBeNull();
    expect(parseValue("true")).toBe("true");
    expect(parseValue("5")).toBe("5");
    expect(parseValue("true", { typed: true })).toBe(true);
    expect(parseValue("false", { typed: true })).toBe(false);
    expect(parseValue("5", { typed: true })).toBe(5);
    expect(parseValue("-2.5e3", { typed: true })).toBe(-2500);
    expect(parseValue("'5'", { typed: true })).toBe("5");
    expect(parseValue("5x", { typed: true })).toBe("5x");
  });

  it("rejects what it does not support instead of guessing", () => {
    expect(() => parseValue("|")).toThrow(YamlError);
    expect(() => parseValue(">")).toThrow(YamlError);
    expect(() => parseValue("{a: 1}")).toThrow(YamlError);
    expect(() => parseValue("'open")).toThrow(YamlError);
    expect(() => parseValue('"open')).toThrow(YamlError);
    expect(() => parseValue("'a' b")).toThrow(YamlError);
    expect(() => parseValue("'a'#b")).toThrow(YamlError);
    expect(() => parseValue('"\\q"')).toThrow(YamlError);
  });
});

describe("parseFrontmatter", () => {
  it("splits fields and body", () => {
    const fm = parseFrontmatter("---\nid: PRO-1\n\n# a comment\nissue: null\nempty:\n---\n\n# Title\n");
    expect(fm.fields).toEqual([
      ["id", "PRO-1"],
      ["issue", "null"],
      ["empty", ""],
    ]);
    expect(fm.body).toBe("\n# Title\n");
  });

  it("accepts CRLF and a BOM", () => {
    const fm = parseFrontmatter("\uFEFF---\r\nid: PRO-1\r\n---\r\nbody");
    expect(fm.fields).toEqual([["id", "PRO-1"]]);
    expect(fm.body).toBe("body");
  });

  it("last duplicate key wins", () => {
    expect(parseFrontmatter("---\na: 1\na: 2\n---\n").fields).toEqual([["a", "2"]]);
  });

  it("rejects missing, unterminated and malformed frontmatter", () => {
    expect(() => parseFrontmatter("# Title")).toThrow(YamlError);
    expect(() => parseFrontmatter("---\nid: PRO-1\n")).toThrow(YamlError);
    expect(() => parseFrontmatter("---\nnot a key value\n---\n")).toThrow(YamlError);
    expect(() => parseFrontmatter("---\n  nested: 1\n---\n")).toThrow(YamlError);
  });

  it("a value that looks like the closing fence cannot end the block early", () => {
    const text = `---\ntitle: ${emitString("---")}\n---\nbody`;
    expect(parseFrontmatter(text).fields).toEqual([["title", "'---'"]]);
  });
});
