import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { Button } from "./primitives/button";
import { Chip } from "./primitives/chip";
import { Stack } from "./primitives/story-frame";
import { ShadowRoot } from "./shadow-root";

const meta: Meta = { title: "Shell/ShadowRoot", component: ShadowRoot };
export default meta;
type Story = StoryObj;

const HOST_RULE = "* { color: red !important; font-size: 30px !important; background: yellow !important; }";

function Probe() {
  const ref = useRef<HTMLButtonElement>(null);
  const [report, setReport] = useState("measuring...");
  useEffect(() => {
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      setReport(`button color: ${cs.color} · font-size: ${cs.fontSize} · ${cs.color.includes("255, 0, 0") || cs.color === "red" ? "LEAKED" : "isolated"}`);
    }, 100);
    return () => clearTimeout(t);
  }, []);
  return (
    <Stack>
      <Button ref={ref} variant="pri">
        Inside the shadow root
      </Button>
      <Chip>{report}</Chip>
    </Stack>
  );
}

/**
 * Injects `* { color: red !important; ... }` into the host document. The Storybook frame around the shadow
 * root turns red/yellow/30px; everything inside the shadow root keeps its own colours and sizes, and the
 * probe prints the computed values.
 */
export const HostCssCannotReachTheShadowTree: Story = {
  render: () => <HostCssDemo />,
};

function HostCssDemo() {
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-story-host-css", "");
    style.textContent = HOST_RULE;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  return <Probe />;
}
