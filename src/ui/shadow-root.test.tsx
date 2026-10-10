import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HOST_TAG, ShadowRoot, useShadowContainer } from "./shadow-root";
import compiledStyles from "./styles.css?inline";
import { mountInShadow } from "./test-utils";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ShadowRoot", () => {
  it("mounts <proompter-root> on body with an open shadow root", async () => {
    const m = await mountInShadow(<p>hello</p>);
    const hosts = document.body.querySelectorAll(HOST_TAG);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.shadowRoot).not.toBeNull();
    await m.unmount();
  });

  it("injects the compiled CSS (tokens + primitives) into the shadow root only", async () => {
    const other = 'style:not([data-proompter-fonts])';
    const headStyles = document.head.querySelectorAll(other).length;
    const m = await mountInShadow(<p>hello</p>);
    const style = m.shadow().querySelector("style");
    expect(style?.textContent).toContain("--acc");
    expect(style?.textContent).toContain("pm-root");
    expect(document.head.querySelectorAll(other).length).toBe(headStyles);
    await m.unmount();
  });

  it("adds the fonts tag to document.head only while mounted (once generated)", async () => {
    const m = await mountInShadow(<p>hello</p>);
    const tags = document.head.querySelectorAll("style[data-proompter-fonts]");
    // Zero until `build-fonts.mjs` has filled fonts-data.ts; never more than one.
    expect(tags.length).toBeLessThanOrEqual(1);
    if (tags.length === 1) {
      expect(tags[0]?.textContent).toContain('font-family:"Proompter Sans"');
      expect(tags[0]?.textContent).toContain('font-family:"Proompter Mono"');
    }
    await m.unmount();
    expect(document.head.querySelector("style[data-proompter-fonts]")).toBeNull();
  });

  it("keeps the focus ring after every `all: unset` rule", () => {
    // happy-dom can't resolve the cascade, so assert what it depends on: the ring (.pp.pp + pseudo, 0,3,0)
    // comes after every `all: unset` rule, so it wins wherever the specificity is equal.
    // A few controls (the ticket's value buttons, the snapshot toggle, the command input) sit at 0,4,0+ on
    // purpose and suppress or restore the outline themselves.
    const ring = /\.pp\.pp\s*:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--acc\)/.exec(compiledStyles);
    expect(ring).not.toBeNull();
    const ringAt = ring!.index;
    const resets = [...compiledStyles.matchAll(/all:\s*unset/g)].map((r) => r.index!);
    expect(resets.length).toBeGreaterThan(0);
    expect(Math.max(...resets)).toBeLessThan(ringAt);
  });

  it("renders children inside the shadow container, not the light DOM", async () => {
    const m = await mountInShadow(<p data-testid="child">hello</p>);
    expect(m.shadow().querySelector('[data-testid="child"]')?.textContent).toBe("hello");
    expect(document.querySelector('[data-testid="child"]')).toBeNull();
    await m.unmount();
  });

  it("exposes the container (.pp) through useShadowContainer", async () => {
    let seen: HTMLElement | null = null;
    function Spy() {
      seen = useShadowContainer();
      return null;
    }
    const m = await mountInShadow(<Spy />);
    expect(seen).not.toBeNull();
    expect((seen as unknown as HTMLElement).className).toContain("pp");
    expect((seen as unknown as HTMLElement).getRootNode()).toBe(m.shadow());
    await m.unmount();
  });

  it("removes the host on unmount, leaving nothing behind", async () => {
    const m = await mountInShadow(<p>hello</p>);
    await m.unmount();
    expect(document.querySelector(HOST_TAG)).toBeNull();
  });

  it("renders nothing and mounts nothing while `parent` is null", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<ShadowRoot parent={null}>x</ShadowRoot>));
    expect(document.querySelector(HOST_TAG)).toBeNull();
    await act(async () => root.unmount());
  });
});
