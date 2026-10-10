import { afterEach, describe, expect, it } from "vitest";
import { layoutDevice, stagePadding } from "../../core/surface";
import { mountInShadow, type Mounted } from "../test-utils";
import { ViewportStage } from "./viewport-stage";

let m: Mounted | null = null;
const restores: Array<() => void> = [];

/** Make `.pm-stage` report `value` for a layout property. happy-dom has no layout, and the getter's owner varies. */
function stubStageSize(prop: "clientWidth" | "clientHeight", value: number) {
  let owner: object | null = HTMLElement.prototype;
  while (owner && !Object.getOwnPropertyDescriptor(owner, prop)) owner = Object.getPrototypeOf(owner);
  const target = owner ?? Element.prototype;
  const original = Object.getOwnPropertyDescriptor(target, prop);
  Object.defineProperty(target, prop, {
    configurable: true,
    get(this: Element) {
      return this.classList.contains("pm-stage") ? value : (original?.get?.call(this) ?? 0);
    },
  });
  restores.push(() => (original ? Object.defineProperty(target, prop, original) : delete (target as Record<string, unknown>)[prop]));
}

afterEach(async () => {
  await m?.unmount();
  m = null;
  restores.splice(0).forEach((r) => r());
});

describe("<ViewportStage> fit-scale", () => {
  it("fits to the stage element's own size, not the window's (a host scrollbar must not count)", async () => {
    // The stage is 985 x 700 while the window reports 1024 x 768 (a 39px-wide scrollbar and a taller window).
    stubStageSize("clientWidth", 985);
    stubStageSize("clientHeight", 700);
    m = await mountInShadow(
      <ViewportStage viewport="mobile" rotated={false} onSurface={() => {}} url="about:blank" />,
      { css: "" },
    );
    const frame = m.shadow().querySelector<HTMLIFrameElement>("iframe")!;
    const want = layoutDevice({
      viewport: "mobile",
      rotated: false,
      stage: { width: 985, height: 700 },
      padding: stagePadding({ viewportWidth: 985 }),
    })!;
    expect(frame.style.transform).toBe(`scale(${want.scale})`);
    expect(want.scale).not.toBeCloseTo(
      layoutDevice({
        viewport: "mobile",
        rotated: false,
        stage: { width: window.innerWidth, height: window.innerHeight },
        padding: stagePadding({ viewportWidth: window.innerWidth }),
      })!.scale,
      3,
    );
  });
});
