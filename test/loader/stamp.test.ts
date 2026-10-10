// @vitest-environment node
import { describe, expect, it } from "vitest";
import { globToRegExp, loadDeps, shouldStamp, stampSource } from "../../src/next/loader.ts";
import { locOf, openTag, readFixture, relOf, stampFixture } from "./helpers.ts";

// Top-level await: several describes stamp fixtures at collection time, before any hook runs.
await loadDeps();

const src = (name: string, code: string, needle: string): string =>
  `data-src="${relOf(name)}:${locOf(code, needle)}"`;

const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;

describe("nested JSX", () => {
  const { code, out } = stampFixture("nested.tsx");

  it("stamps every intrinsic element with repo-relative path:line:col", () => {
    expect(count(out.code, /data-src=/g)).toBe(6); // article header h2 svg path my-widget
    expect(openTag(out.code, "article")).toContain(src("nested.tsx", code, "<article"));
    expect(openTag(out.code, "h2")).toContain(src("nested.tsx", code, "<h2"));
    expect(openTag(out.code, "path")).toContain(src("nested.tsx", code, "<path"));
  });

  it("stamps svg and path", () => {
    expect(openTag(out.code, "svg")).toContain("data-src=");
    expect(openTag(out.code, "path")).toContain("data-src=");
  });

  it("stamps custom elements (lowercase with a dash)", () => {
    expect(openTag(out.code, "my-widget")).toContain("data-src=");
  });

  it("leaves member expressions alone", () => {
    expect(out.code).toContain("<motion.div />");
  });

  it("puts data-comp on the root element only", () => {
    expect(count(out.code, /data-comp=/g)).toBe(1);
    expect(openTag(out.code, "article")).toContain('data-comp="Card"');
  });

  it("keeps the original attributes and children", () => {
    expect(openTag(out.code, "article")).toContain('className="card"');
    expect(out.code).toContain("{title}</h2>");
  });
});

describe("fragments", () => {
  const { out } = stampFixture("fragments.tsx");

  it("a fragment with a single element child: that child is the root", () => {
    expect(openTag(out.code, "section")).toContain('data-comp="Single"');
    expect(openTag(out.code, "p")).not.toContain("data-comp");
  });

  it("a fragment with several children has no single root: no data-comp, children still stamped", () => {
    expect(openTag(out.code, "dt")).toContain("data-src=");
    expect(openTag(out.code, "dd")).toContain("data-src=");
    expect(openTag(out.code, "dt")).not.toContain("data-comp");
    expect(openTag(out.code, "dd")).not.toContain("data-comp");
  });

  it("nested single-child fragments are looked through", () => {
    expect(openTag(out.code, "b")).toContain('data-comp="Nested"');
  });

  it("never stamps the fragments themselves", () => {
    expect(out.code).toContain("<>");
    expect(out.code).not.toMatch(/<>\s*data-/);
  });
});

describe("conditional elements", () => {
  const { out } = stampFixture("conditional.tsx");

  it("ternary return: both branches are roots", () => {
    expect(openTag(out.code, "a")).toContain('data-comp="Either"');
    expect(openTag(out.code, "button")).toContain('data-comp="Either"');
  });

  it("`cond && <x/>` return: the right side is the root", () => {
    expect(openTag(out.code, "aside")).toContain('data-comp="Maybe"');
  });

  it("every return statement counts", () => {
    expect(openTag(out.code, "p")).toContain('data-comp="Early"');
    expect(openTag(out.code, "ul")).toContain('data-comp="Early"');
    expect(openTag(out.code, "li")).not.toContain("data-comp");
  });

  it("elements nested in conditionals are stamped but are not roots", () => {
    expect(openTag(out.code, "div")).toContain('data-comp="Inline"');
    for (const tag of ["span", "i", "u"]) {
      expect(openTag(out.code, tag)).toContain("data-src=");
      expect(openTag(out.code, tag)).not.toContain("data-comp");
    }
  });
});

describe("props spread", () => {
  it("inserts the stamp before the spread so user props can still override it", () => {
    const { out } = stampFixture("spread.tsx");
    expect(openTag(out.code, "div")).toMatch(/^<div data-src="[^"]+" data-comp="Spread" \{\.\.\.props\} className="x">$/);
    expect(openTag(out.code, "span")).toMatch(/^<span data-src="[^"]+" \{\.\.\.props\} \/>$/);
  });
});

describe("existing attributes", () => {
  it("never duplicates or overrides data-src / data-comp", () => {
    const { out } = stampFixture("existing.tsx");
    expect(openTag(out.code, "div")).toBe('<div data-src="custom:1:1" data-comp="Mine">');
    expect(openTag(out.code, "span")).toBe('<span data-src="x">');
    expect(openTag(out.code, "b")).toContain(`data-src="${relOf("existing.tsx")}:`);
    expect(count(out.code, /data-src=/g)).toBe(3);
  });

  it("returns null when there is nothing left to stamp", () => {
    expect(stampSource('export const A = () => <div data-src="x" data-comp="A" />;', "a.tsx")).toBeNull();
  });
});

describe("TypeScript in .tsx", () => {
  const { out } = stampFixture("generics.tsx");

  it("parses `<T,>` generic arrows and names the component", () => {
    expect(openTag(out.code, "ul")).toContain('data-comp="Pick"');
    expect(openTag(out.code, "li")).toContain("data-src=");
  });

  it("parses generic functions, `as` and non-null assertions", () => {
    expect(openTag(out.code, "ol")).toContain('data-comp="List"');
    expect(openTag(out.code, "p")).toContain('data-comp="Typed"');
    expect(out.code).toContain("items.length as number");
    expect(out.code).toContain("(x as string)!");
  });
});

describe("component forms", () => {
  const { out } = stampFixture("wrappers.tsx");

  it("forwardRef / memo / class render() name their roots", () => {
    expect(openTag(out.code, "button")).toContain('data-comp="Fwd"');
    expect(openTag(out.code, "nav")).toContain('data-comp="Memoed"');
    expect(openTag(out.code, "main")).toContain('data-comp="Klass"');
  });

  it("lowercase functions are not components, but their elements still get data-src", () => {
    expect(openTag(out.code, "em")).toContain("data-src=");
    expect(openTag(out.code, "em")).not.toContain("data-comp");
  });
});

describe("server components and directives", () => {
  it('skips files that start with "use server"', () => {
    expect(stampSource(readFixture("server.tsx"), relOf("server.tsx"))).toBeNull();
  });

  it('a "use server" later in a function body does not skip the file', () => {
    const code = 'export function A() { "use server"; return <div />; }';
    expect(stampSource(code, "a.tsx")?.code).toContain("data-src=");
  });

  it("an async server component without a directive is stamped", () => {
    const { out } = stampFixture("rsc.tsx");
    expect(openTag(out.code, "main")).toContain('data-comp="Page"');
    expect(openTag(out.code, "p")).toContain("data-src=");
  });

  it('"use client" files are stamped (and keep the directive first)', () => {
    const { out } = stampFixture("client.tsx");
    expect(out.code.startsWith('"use client";')).toBe(true);
    expect(openTag(out.code, "button")).toContain('data-comp="Counter"');
  });
});

describe("decorators", () => {
  it("parses a decorated class component (legacy decorators)", () => {
    const { out } = stampFixture("decorated.tsx");
    expect(openTag(out.code, "section")).toContain('data-comp="Decorated"');
    expect(out.code).toContain("@track");
    expect(out.code).toContain("@logged");
  });

  it("parses `accessor` fields", () => {
    const { out } = stampFixture("accessor.tsx");
    expect(openTag(out.code, "output")).toContain('data-comp="Counter"');
    expect(out.code).toContain("accessor count = 0;");
  });
});

describe("non-DOM renderers", () => {
  it("skips files importing @react-three/fiber or drei", () => {
    expect(stampSource(readFixture("r3f.tsx"), relOf("r3f.tsx"))).toBeNull();
    expect(
      stampSource('import { Html } from "@react-three/drei/core";\nexport const A = () => <mesh />;', "a.tsx"),
    ).toBeNull();
  });

  it("other @react-three packages are not affected", () => {
    const out = stampSource('import { Physics } from "@react-three/rapier";\nexport const A = () => <div />;', "a.tsx");
    expect(out?.code).toContain("data-src=");
  });
});

describe("edge cases", () => {
  it("namespaced names are left alone (attributes and elements)", () => {
    const out = stampSource('export const A = () => <svg><use xlink:href="#a" /><svg:rect /></svg>;', "a.tsx");
    expect(out?.code).toContain('<use data-src="a.tsx:1:');
    expect(out?.code).toContain('xlink:href="#a"');
    expect(out?.code).toContain("<svg:rect />");
  });

  it(".jsx files parse as plain JS", () => {
    const out = stampSource("export const A = () => <div>{1 < 2}</div>;", "a.jsx");
    expect(out?.code).toContain('<div data-src="a.jsx:1:24" data-comp="A">');
  });

  it("passes unparsable input through (null) instead of throwing", () => {
    expect(stampSource("const = <div", "a.tsx")).toBeNull();
  });

  it("returns null for files without JSX", () => {
    expect(stampSource("export const a = 1;", "a.tsx")).toBeNull();
  });

  it("escapes quotes and ampersands in the path", () => {
    const out = stampSource("export const A = () => <i />;", 'we"ird&.tsx');
    expect(out?.code).toContain('data-src="we&quot;ird&amp;.tsx:1:');
  });
});

describe("file selection", () => {
  it("only .tsx / .jsx", () => {
    expect(shouldStamp("app/page.tsx")).toBe(true);
    expect(shouldStamp("app/page.jsx")).toBe(true);
    expect(shouldStamp("app/page.ts")).toBe(false);
    expect(shouldStamp("app/page.js")).toBe(false);
  });

  it("skips node_modules, .next, stories, tests and specs", () => {
    expect(shouldStamp("node_modules/x/y.tsx")).toBe(false);
    expect(shouldStamp("packages/ui/node_modules/x/y.tsx")).toBe(false);
    expect(shouldStamp(".next/server/page.tsx")).toBe(false);
    expect(shouldStamp("src/Button.stories.tsx")).toBe(false);
    expect(shouldStamp("src/Button.test.tsx")).toBe(false);
    expect(shouldStamp("src/Button.spec.jsx")).toBe(false);
    expect(shouldStamp("src/stories-helper.tsx")).toBe(true);
  });

  it("include / exclude globs", () => {
    expect(shouldStamp("app/a.tsx", { include: ["app/**"] })).toBe(true);
    expect(shouldStamp("lib/a.tsx", { include: ["app/**"] })).toBe(false);
    expect(shouldStamp("app/admin/a.tsx", { exclude: ["**/admin/**"] })).toBe(false);
    expect(shouldStamp("app/a.tsx", { include: ["app/**"], exclude: ["**/admin/**"] })).toBe(true);
  });

  it("brace alternation", () => {
    const opts = { include: ["app/**/*.{tsx,jsx}"] };
    expect(shouldStamp("app/a/b.tsx", opts)).toBe(true);
    expect(shouldStamp("app/b.jsx", opts)).toBe(true);
    expect(globToRegExp("{app,lib}/x.tsx").test("lib/x.tsx")).toBe(true);
    expect(globToRegExp("{app,lib}/x.tsx").test("src/x.tsx")).toBe(false);
    expect(globToRegExp("a{b.tsx").test("a{b.tsx")).toBe(true); // unbalanced: literal
  });

  it("a bare directory pattern matches everything beneath it", () => {
    expect(shouldStamp("app/x/page.tsx", { exclude: ["app/x"] })).toBe(false);
    expect(shouldStamp("app/x/deep/page.tsx", { exclude: ["app/x/"] })).toBe(false);
    expect(shouldStamp("app/xy/page.tsx", { exclude: ["app/x"] })).toBe(true);
    expect(shouldStamp("app/x/page.tsx", { include: ["app/x"] })).toBe(true);
    // ...but a pattern ending in a wildcard keeps its exact meaning
    expect(globToRegExp("app/*").test("app/a/b.tsx")).toBe(false);
  });

  it("globToRegExp: * does not cross slashes, ** does", () => {
    expect(globToRegExp("src/*.tsx").test("src/a.tsx")).toBe(true);
    expect(globToRegExp("src/*.tsx").test("src/x/a.tsx")).toBe(false);
    expect(globToRegExp("src/**/*.tsx").test("src/a.tsx")).toBe(true);
    expect(globToRegExp("src/**/*.tsx").test("src/x/y/a.tsx")).toBe(true);
    expect(globToRegExp("a?.tsx").test("ab.tsx")).toBe(true);
  });
});
