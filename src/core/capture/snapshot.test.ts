import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPng } from "html-to-image";
import { createCapture } from "./index.ts";
import type { Surface } from "../surface";
import { makeWin } from "./helpers.test-util.ts";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));
const mockToPng = vi.mocked(toPng);

function surface() {
  const doc = document.implementation.createHTMLDocument("frame");
  const el = doc.createElement("div");
  doc.body.appendChild(el);
  const win = makeWin();
  const s: Surface = { doc, win, toScreen: (r) => r, scale: 1 };
  return { s, el, doc };
}

beforeEach(() => {
  mockToPng.mockReset();
});

describe("snapshot", () => {
  it("returns element and viewport PNG data URLs from the surface document", async () => {
    mockToPng.mockImplementation(async (node) => `data:image/png;base64,${(node as HTMLElement).tagName}`);
    const { s, el, doc } = surface();
    const res = await createCapture({ win: s.win }).snapshot(s, el);
    expect(res).toEqual({
      fontsEmbedded: true,
      element: "data:image/png;base64,DIV",
      viewport: "data:image/png;base64,HTML",
    });
    expect(mockToPng.mock.calls[1]?.[0]).toBe(doc.documentElement);
    expect(mockToPng.mock.calls[1]?.[1]).toMatchObject({ width: 800, height: 600 });
  });

  it("captures only the viewport without an element", async () => {
    mockToPng.mockResolvedValue("data:image/png;base64,V");
    const { s } = surface();
    const res = await createCapture({ win: s.win }).snapshot(s);
    expect(res.element).toBeUndefined();
    expect(res.viewport).toBe("data:image/png;base64,V");
  });

  it("falls back to skipFonts and reports fontsEmbedded: false when embedding fails", async () => {
    mockToPng.mockImplementation(async (_n, opts) => {
      if (!opts?.skipFonts) throw new Error("SecurityError: cssRules (CORS)");
      return "data:image/png;base64,OK";
    });
    const { s, el } = surface();
    const cap = createCapture({ win: s.win });
    const res = await cap.snapshot(s, el);
    expect(res).toEqual({ fontsEmbedded: false, element: "data:image/png;base64,OK", viewport: "data:image/png;base64,OK" });
    // the viewport render skipped the doomed font attempt: 2 (element) + 1 (viewport)
    expect(mockToPng).toHaveBeenCalledTimes(3);
    expect(cap.context().internalErrors[0]?.where).toBe("snapshot:fonts");
  });

  it("never throws: reports an error when even the fallback fails", async () => {
    mockToPng.mockRejectedValue(new Error("render failed"));
    const { s, el } = surface();
    const res = await createCapture({ win: s.win }).snapshot(s, el);
    // a failure that survives the skipFonts retry is not a font problem
    expect(res.fontsEmbedded).toBe(true);
    expect(res.element).toBeUndefined();
    expect(res.viewport).toBeUndefined();
    expect(res.error).toBe("render failed");
  });

  it("filters out the kit's own UI", async () => {
    mockToPng.mockResolvedValue("data:image/png;base64,V");
    const { s, el, doc } = surface();
    await createCapture({ win: s.win }).snapshot(s, el);
    const filter = mockToPng.mock.calls[0]?.[1]?.filter as (n: Node) => boolean;
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
    expect(mockToPng.mock.calls[1]?.[1]?.filter).toBe(filter);
  });
});
