import { useState, type CSSProperties, type ReactNode } from "react";
import { ShadowRoot } from "../shadow-root";

/**
 * Storybook helpers. Not exported from the package. `StoryFrame` is the global decorator: every story
 * renders inside a real `<ShadowRoot>`, exactly as it will in production.
 */
export function StoryFrame({ children }: { children?: ReactNode }) {
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  return (
    <div style={{ background: "#09090b", padding: 40, minWidth: 420, borderRadius: 12 }}>
      <div ref={setMount} />
      {mount ? <ShadowRoot parent={mount}>{children}</ShadowRoot> : null}
    </div>
  );
}

/**
 * For `play` functions: stories render inside a shadow root, which `within(canvasElement)` can't see.
 * Resolves the shadow root once it has mounted. Use `within(shadow as unknown as HTMLElement)`.
 */
export async function shadowOf(canvasElement: HTMLElement): Promise<ShadowRoot> {
  for (let i = 0; i < 100; i++) {
    const root = canvasElement.querySelector("proompter-root")?.shadowRoot;
    if (root?.querySelector(".pp > *")) return root;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("shadow root did not mount");
}

const rowStyle: CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

export function Row({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...rowStyle, ...style }}>{children}</div>;
}

export function Stack({ children, gap = 20 }: { children?: ReactNode; gap?: number }) {
  return <div style={{ display: "grid", gap }}>{children}</div>;
}

export function Caption({ children }: { children?: ReactNode }) {
  return <div style={{ font: "500 11px/16px var(--sans)", color: "var(--fg-3)", marginBottom: 6 }}>{children}</div>;
}
