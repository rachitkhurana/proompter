import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toSvg } from "html-to-image";
import { createCapture } from "./index.ts";
import { maskSvg } from "./snapshot.ts";
import type { Surface } from "../surface";
import { makeWin } from "./helpers.test-util.ts";

vi.mock("html-to-image", () => ({ toSvg: vi.fn() }));
const mockToSvg = vi.mocked(toSvg);

const PNG = "data:image/png;base64,PNG";

/** A rendered snapshot in miniature: an SVG data URL with XHTML inside a foreignObject, as html-to-image makes. */
const FIXTURE =
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="100%" height="100%">` +
  `<div xmlns="http://www.w3.org/1999/xhtml" id="root" style="color:red">` +
  `<input id="text" type="text" value="secret" style="border:1px solid red"/>` +
  `<input id="check" type="checkbox"/><input id="btn" type="submit"/>` +
  `<textarea id="area">secret</textarea><select id="sel"><option>secret</option></select><output id="out">1</output>` +
  `<div id="edit" contenteditable="">secret</div><div id="role" role="textbox">secret</div><div id="combo" role="combobox">x</div>` +
  `<div id="marked" data-proompter-redact="">secret</div><span id="plugin" class="card-number">4242</span><p id="plain">hello</p>` +
  `</div></foreignObject></svg>`;
const toUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const parse = (url: string) => new DOMParser().parseFromString(decodeURIComponent(url.slice(url.indexOf(",") + 1)), "image/svg+xml");

function surface() {
  const doc = document.implementation.createHTMLDocument("frame");
  const el = doc.createElement("div");
  doc.body.appendChild(el);
  const win = makeWin();
  const s: Surface = { doc, win, toScreen: (r) => r, scale: 1 };
  return { s, el, doc };
}

describe("maskSvg", () => {
  const masked = (extra: string[] = []) => parse(maskSvg(toUrl(FIXTURE), extra));
  const isMasked = (d: Document, id: string) => (d.getElementById(id)?.getAttribute("style") ?? "").includes("filter:brightness(0)!important");

  it("blacks out the default fields, the marked elements and nothing else", () => {
    const d = masked();
    for (const id of ["text", "area", "sel", "out", "edit", "role", "combo", "marked"]) expect(isMasked(d, id), id).toBe(true);
    for (const id of ["check", "btn", "plain", "root", "plugin"]) expect(isMasked(d, id), id).toBe(false);
  });

  it("applies the black box, text and border, and keeps the element's own inline style before it", () => {
    const style = masked().getElementById("text")!.getAttribute("style")!;
    expect(style.startsWith("border:1px solid red;")).toBe(true);
    for (const decl of ["background:#000!important", "color:#000!important", "-webkit-text-fill-color:#000!important", "border-color:#000!important", "text-shadow:none!important", "box-shadow:none!important"]) {
      expect(style).toContain(decl);
    }
  });

  it("clears typed values and text from inputs, textareas and selects", () => {
    const d = masked();
    expect(d.getElementById("text")!.hasAttribute("value")).toBe(false);
    expect(d.getElementById("area")!.textContent).toBe("");
    expect(d.getElementById("sel")!.textContent).toBe("");
  });

  it("honours plugin selectors", () => {
    expect(isMasked(masked([".card-number"]), "plugin")).toBe(true);
  });

  it("throws on an SVG that does not parse and on a bad plugin selector", () => {
    expect(() => maskSvg(toUrl("<svg><unclosed></svg>"), [])).toThrow();
    expect(() => maskSvg(toUrl(FIXTURE), ["((bad"])).toThrow();
  });
});

describe("snapshot", () => {
  let drawn: Array<[number, number]> = [];
  let drawable = true;
  let decodes = true;

  beforeEach(() => {
    mockToSvg.mockReset();
    drawn = [];
    drawable = true;
    decodes = true;
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        async decode() {
          if (!decodes) throw new Error("decode failed");
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
      drawable ? { drawImage: () => {} } : null) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
      drawn.push([this.width, this.height]);
      return PNG;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns masked element and viewport PNGs from the surface document, drawn at the device pixel ratio", async () => {
    mockToSvg.mockResolvedValue(toUrl(FIXTURE));
    const { s, el, doc } = surface();
    el.getBoundingClientRect = () => ({ width: 100, height: 40 }) as DOMRect;
    const res = await createCapture({ win: s.win }).snapshot(s, el);
    expect(res).toEqual({ fontsEmbedded: true, element: PNG, viewport: PNG });
    expect(mockToSvg.mock.calls[0]?.[0]).toBe(el);
    expect(mockToSvg.mock.calls[1]?.[0]).toBe(doc.documentElement);
    expect(mockToSvg.mock.calls[1]?.[1]).toMatchObject({ width: 800, height: 600 });
    // the clone keeps the live box size; the image adds PADDING on each side
    expect(mockToSvg.mock.calls[0]?.[1]).toMatchObject({ width: 124, height: 64 });
    expect(mockToSvg.mock.calls[0]?.[1]?.style).toMatchObject({ width: "100px", height: "40px", boxSizing: "border-box", margin: "12px" });
    expect(drawn).toEqual([
      [248, 128],
      [1600, 1200],
    ]);
  });

  it("captures only the viewport without an element", async () => {
    mockToSvg.mockResolvedValue(toUrl(FIXTURE));
    const { s } = surface();
    const res = await createCapture({ win: s.win }).snapshot(s);
    expect(res.element).toBeUndefined();
    expect(res.viewport).toBe(PNG);
  });

  it("falls back to skipFonts and reports fontsEmbedded: false when embedding fails", async () => {
    mockToSvg.mockImplementation(async (_n, opts) => {
      if (!opts?.skipFonts) throw new Error("SecurityError: cssRules (CORS)");
      return toUrl(FIXTURE);
    });
    const { s, el } = surface();
    const cap = createCapture({ win: s.win });
    const res = await cap.snapshot(s, el);
    expect(res).toEqual({ fontsEmbedded: false, element: PNG, viewport: PNG });
    // the viewport render skipped the doomed font attempt: 2 (element) + 1 (viewport)
    expect(mockToSvg).toHaveBeenCalledTimes(3);
    expect(cap.context().internalErrors[0]?.where).toBe("snapshot:fonts");
  });

  it("never throws: reports an error when even the fallback fails", async () => {
    mockToSvg.mockRejectedValue(new Error("render failed"));
    const { s, el } = surface();
    const res = await createCapture({ win: s.win }).snapshot(s, el);
    // a failure that survives the skipFonts retry is not a font problem
    expect(res.fontsEmbedded).toBe(true);
    expect(res.element).toBeUndefined();
    expect(res.viewport).toBeUndefined();
    expect(res.error).toBe("render failed");
    expect(res.redactFailed).toBeUndefined();
  });

  it("filters out the kit's own UI", async () => {
    mockToSvg.mockResolvedValue(toUrl(FIXTURE));
    const { s, el, doc } = surface();
    await createCapture({ win: s.win }).snapshot(s, el);
    const filter = mockToSvg.mock.calls[0]?.[1]?.filter as (n: Node) => boolean;
    const root = doc.createElement("proompter-root"); // custom element tag, as mounted by the UI host
    const lookalike = doc.createElement("div");
    lookalike.id = "proompter-root"; // an id is not the host
    expect(filter(lookalike)).toBe(true);
    const tagged = doc.createElement("span");
    tagged.setAttribute("data-proompter", "");
    expect(filter(root)).toBe(false);
    expect(filter(tagged)).toBe(false);
    expect(filter(el)).toBe(true);
    expect(filter(doc.createTextNode("hi"))).toBe(true);
    expect(mockToSvg.mock.calls[1]?.[1]?.filter).toBe(filter);
  });

  describe("fails closed: no PNG, redactFailed and a snapshot:redact error", () => {
    const run = async (redact?: string[]) => {
      const { s, el } = surface();
      const cap = createCapture({ win: s.win });
      const res = await cap.snapshot(s, el, redact);
      expect(res.element).toBeUndefined();
      expect(res.viewport).toBeUndefined();
      expect(res.redactFailed).toBe(true);
      expect(res.error).toBeUndefined();
      expect(cap.context().internalErrors.map((e) => e.where)).toEqual(["snapshot:redact", "snapshot:redact"]);
    };

    it("when the SVG does not parse", async () => {
      mockToSvg.mockResolvedValue(toUrl("<svg><unclosed></svg>"));
      await run();
    });
    it("when a plugin selector throws", async () => {
      mockToSvg.mockResolvedValue(toUrl(FIXTURE));
      await run(["((bad"]);
    });
    it("when the image does not decode", async () => {
      decodes = false;
      mockToSvg.mockResolvedValue(toUrl(FIXTURE));
      await run();
    });
    it("when there is no canvas", async () => {
      drawable = false;
      mockToSvg.mockResolvedValue(toUrl(FIXTURE));
      await run();
    });
  });
});
