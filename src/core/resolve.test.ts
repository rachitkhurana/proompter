import { afterEach, describe, expect, it } from "vitest";
import {
  retarget,
  describeTarget,
  findBySelector,
  isInKit,
  labelOf,
  parentTarget,
  resolveTarget,
  selectorFor,
  shortSource,
  targetFor,
} from "./resolve";
import { boxAll, html, setRect } from "./test-dom";

afterEach(() => {
  document.body.innerHTML = "";
});

const card = (n: number) => `
  <article data-src="app/post-card.tsx:20:5" data-comp="PostCard" id="card-${n}">
    <header data-src="app/post-card.tsx:22:7">
      <div data-src="app/avatar.tsx:5:5" data-comp="Avatar">
        <img data-src="app/avatar.tsx:6:7" class="avatar" alt="" src="x.png" id="avatar-${n}">
      </div>
      <span data-src="app/post-card.tsx:24:9" id="name-${n}">Rachit</span>
    </header>
    <p data-src="app/post-card.tsx:26:7" id="body-${n}">Clutched a 1v4 against the whole lobby</p>
    <button data-src="app/post-card.tsx:28:7" id="share-${n}">Share</button>
  </article>`;

const PAGE = `
  <main data-src="app/feed.tsx:10:5" data-comp="FeedPage">
    <h1 data-src="app/feed.tsx:11:7">Feed</h1>
    ${card(1)}
    ${card(2)}
    <aside data-src="app/aside.tsx:1:1">
      <ul><li id="li-1">a</li><li id="li-2">b</li></ul>
    </aside>
  </main>`;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

describe("targetFor", () => {
  it("lands on the deepest element that is at least 6x6", () => {
    boxAll(html(PAGE));
    expect(targetFor($("#avatar-1"))).toBe($("#avatar-1"));
    expect(targetFor($("#body-1").firstChild)).toBe($("#body-1")); // a text node resolves to its element
  });

  it("walks up past elements under 6px on either side", () => {
    boxAll(html(PAGE));
    setRect($("#name-1"), 0, 0, 5, 20);
    expect(targetFor($("#name-1"))).toBe(($("#card-1").querySelector("header") as HTMLElement));
    setRect($("#name-1"), 0, 0, 40, 5);
    expect(targetFor($("#name-1"))).toBe(($("#card-1").querySelector("header") as HTMLElement));
    setRect($("#name-1"), 0, 0, 6, 6);
    expect(targetFor($("#name-1"))).toBe($("#name-1"));
  });

  it("never returns html or body", () => {
    boxAll(html(PAGE));
    setRect(document.body, 0, 0, 800, 600);
    setRect(document.documentElement, 0, 0, 800, 600);
    expect(targetFor(document.body)).toBeNull();
    expect(targetFor(document.documentElement)).toBeNull();
  });

  it("never returns our own UI, including inside the shadow root", () => {
    const body = html(`<div id="app">app</div><proompter-root></proompter-root>`);
    const host = body.querySelector("proompter-root") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div class="pp"><button id="kit-btn">Pick</button></div>`;
    boxAll(body);
    const btn = shadow.querySelector("#kit-btn") as HTMLElement;
    setRect(btn, 0, 0, 40, 20);
    setRect(host, 0, 0, 100, 100);
    expect(isInKit(btn)).toBe(true);
    expect(isInKit(host)).toBe(true);
    expect(isInKit($("#app"))).toBe(false);
    expect(targetFor(btn)).toBeNull();
    expect(targetFor(host)).toBeNull();
  });
});

describe("source", () => {
  it("uses the element's own data-src", () => {
    html(PAGE);
    const t = describeTarget($("#avatar-1"));
    expect(t.source).toBe("app/avatar.tsx:6:7");
    expect(t.inherited).toBe(false);
  });

  it("falls back to the nearest stamped ancestor and says so", () => {
    html(PAGE);
    const t = describeTarget($("#li-2"));
    expect(t.source).toBe("app/aside.tsx:1:1");
    expect(t.inherited).toBe(true);
  });

  it("reports a missing source as null, never a guess", () => {
    html(`<div><p id="x">hello</p></div>`);
    const t = describeTarget($("#x"));
    expect(t.source).toBeNull();
    expect(t.inherited).toBe(false);
  });

  it("shortens a path to the file name", () => {
    expect(shortSource("src/app/(app)/feeds/post-card.tsx:48:7")).toBe("post-card.tsx:48:7");
  });
});

describe("label", () => {
  it("uses the component name when the element is a component root", () => {
    html(PAGE);
    expect(labelOf($("#card-1"))).toBe("PostCard");
  });

  it("uses the last name of a › chain", () => {
    html(`<div data-comp="FeedPage › FeedList › PostCard" id="x"></div>`);
    expect(labelOf($("#x"))).toBe("PostCard");
  });

  it("img with an avatar class reads img · avatar", () => {
    html(PAGE);
    expect(labelOf($("#avatar-1"))).toBe("img · avatar");
  });

  it("falls back to an img's alt text", () => {
    html(`<img id="x" alt="Team logo" src="a.png">`);
    expect(labelOf($("#x"))).toBe("img · Team logo");
  });

  it("buttons and links show their text in quotes", () => {
    html(PAGE);
    expect(labelOf($("#share-1"))).toBe("button “Share”");
  });

  it("a text leaf shows the start of its text, with an ellipsis when cut", () => {
    html(PAGE);
    expect(labelOf($("#body-1"))).toBe("p “Clutched a 1v4 again…”");
    expect(labelOf($("#name-1"))).toBe("span “Rachit”");
  });

  it("a plain container is just its tag", () => {
    html(PAGE);
    expect(labelOf($("ul"))).toBe("ul");
  });
});

describe("crumb", () => {
  it("is the component chain down to the element", () => {
    html(PAGE);
    const t = resolveTarget($("#avatar-1"));
    expect(t.crumb).toBe("FeedPage › PostCard › Avatar › img · avatar");
  });

  it("ends at the component when the element is a component root", () => {
    html(PAGE);
    expect(resolveTarget($("#card-2")).crumb).toBe("FeedPage › PostCard");
  });

  it("expands a › chain stamped on one element, without repeating names", () => {
    html(`<div data-comp="App › Feed"><div data-comp="Feed"><p id="x">hi</p></div></div>`);
    expect(resolveTarget($("#x")).crumb).toBe("App › Feed › p “hi”");
  });

  it("is just the label when no component is stamped", () => {
    html(`<div><button id="x">Go</button></div>`);
    expect(resolveTarget($("#x")).crumb).toBe("button “Go”");
  });
});

describe("selector", () => {
  it("is the element's own data-src when that is unique", () => {
    html(PAGE);
    expect(selectorFor($("h1"))).toBe('[data-src="app/feed.tsx:11:7"]');
    expect(selectorFor($("aside"))).toBe('[data-src="app/aside.tsx:1:1"]');
  });

  it("anchors an nth-of-type chain at the nearest unique stamped ancestor", () => {
    html(PAGE);
    expect(selectorFor($("#li-2"))).toBe('[data-src="app/aside.tsx:1:1"] > ul:nth-of-type(1) > li:nth-of-type(2)');
  });

  it("tells duplicate stamped components apart", () => {
    html(PAGE);
    // The two cards share every data-src value, so none of them is unique.
    expect(selectorFor($("#avatar-1"))).toBe(
      '[data-src="app/feed.tsx:10:5"] > article:nth-of-type(1) > header:nth-of-type(1) > div:nth-of-type(1) > img:nth-of-type(1)',
    );
    expect(selectorFor($("#avatar-2"))).toBe(
      '[data-src="app/feed.tsx:10:5"] > article:nth-of-type(2) > header:nth-of-type(1) > div:nth-of-type(1) > img:nth-of-type(1)',
    );
  });

  it("counts siblings of the same tag only", () => {
    html(PAGE);
    // h1 is the first child of main but the cards are article #1 and #2 of their type.
    expect(selectorFor($("#card-1")).endsWith("article:nth-of-type(1)")).toBe(true);
    expect(selectorFor($("#card-2")).endsWith("article:nth-of-type(2)")).toBe(true);
  });

  it("matches exactly the element, for every element in the page (uniqueness + round trip)", () => {
    html(PAGE);
    const all = Array.from(document.body.querySelectorAll("*"));
    expect(all.length).toBeGreaterThan(15);
    for (const el of all) {
      const sel = selectorFor(el);
      const found = document.querySelectorAll(sel);
      expect(found.length, sel).toBe(1);
      expect(found[0], sel).toBe(el);
      expect(findBySelector(document, sel), sel).toBe(el);
    }
  });

  it("falls back to a chain from body when nothing is stamped", () => {
    html(`<div><p>one</p><p id="x">two</p></div>`);
    expect(selectorFor($("#x"))).toBe("body > div:nth-of-type(1) > p:nth-of-type(2)");
    expect(findBySelector(document, selectorFor($("#x")))).toBe($("#x"));
  });

  it("is unique even when every stamp is a duplicate (list items from a map)", () => {
    html(`<ul>${"<li data-src=\"a.tsx:1:1\"><b data-src=\"a.tsx:2:1\">x</b></li>".repeat(3)}</ul>`);
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      expect(findBySelector(document, selectorFor(el))).toBe(el);
    }
  });

  it("survives quotes, backslashes, brackets and parentheses in data-src", () => {
    html(`<main><div id="x"></div><div id="y"></div></main>`);
    $("#x").setAttribute("data-src", 'src/app/(app)/[slugId]/a "b" \\c.tsx:1:1');
    expect(findBySelector(document, selectorFor($("#x")))).toBe($("#x"));
    $("#y").setAttribute("data-src", "src/app/(app)/[slugId]/page.tsx:1:1");
    expect(selectorFor($("#y"))).toBe('[data-src="src/app/(app)/[slugId]/page.tsx:1:1"]');
  });

  it("returns null for stale or invalid selectors", () => {
    html(PAGE);
    expect(findBySelector(document, '[data-src="nope"]')).toBeNull();
    expect(findBySelector(document, "")).toBeNull();
    expect(findBySelector(document, null)).toBeNull();
    expect(findBySelector(document, "[[[")).toBeNull();
  });
});

describe("resolveTarget", () => {
  it("returns the full shape", () => {
    html(PAGE);
    const t = resolveTarget($("#avatar-2"));
    expect(t.el).toBe($("#avatar-2"));
    expect(t.source).toBe("app/avatar.tsx:6:7");
    expect(t.inherited).toBe(false);
    expect(t.label).toBe("img · avatar");
    expect(t.crumb).toBe("FeedPage › PostCard › Avatar › img · avatar");
    expect(findBySelector(document, t.selector)).toBe(t.el);
  });

  it("marks an unstamped child of a stamped element as inherited", () => {
    html(`<section data-src="a/b.tsx:3:3"><div><span id="x">hi</span></div></section>`);
    const t = resolveTarget($("#x"));
    expect(t.inherited).toBe(true);
    expect(t.source).toBe("a/b.tsx:3:3");
    expect(t.selector).toBe('[data-src="a/b.tsx:3:3"] > div:nth-of-type(1) > span:nth-of-type(1)');
  });
});

describe("parentTarget", () => {
  it("stops below body", () => {
    html(PAGE);
    expect(parentTarget($("#avatar-1"))).toBe($("#avatar-1").parentElement);
    expect(parentTarget($("main"))).toBeNull();
  });
});

describe("host app shadow roots", () => {
  function withCard() {
    html(`<main data-src="app/feed.tsx:1:1"><span id="light">light</span><x-card id="card"></x-card></main>`);
    const card = $("#card");
    const shadow = card.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div><span id="inner">inside</span></div>`;
    boxAll(document.body);
    boxAll(shadow as unknown as Element);
    return { card, inner: shadow.querySelector("#inner") as HTMLElement };
  }

  it("retargets out of a non-kit shadow root to its host", () => {
    const { card, inner } = withCard();
    expect(retarget(inner)).toBe(card);
    expect(retarget($("#light"))).toBe($("#light"));
    expect(targetFor(inner)).toBe(card);
  });

  it("names the host element, never a different light-DOM element", () => {
    const { card, inner } = withCard();
    const t = resolveTarget(inner);
    expect(t.el).toBe(card);
    expect(findBySelector(document, t.selector)).toBe(card);
    expect(selectorFor(inner)).toBe(t.selector);
    // The old behaviour: body > div > span, which hit the unrelated <span id="light">.
    expect(findBySelector(document, t.selector)).not.toBe($("#light"));
  });
});
