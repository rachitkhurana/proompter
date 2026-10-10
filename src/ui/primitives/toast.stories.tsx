import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Button } from "./button";
import { Row, Stack } from "./story-frame";
import { toast, Toaster } from "./toast";

const meta: Meta = { title: "Primitives/Toast", component: Toaster };
export default meta;
type Story = StoryObj;

let n = 0;

function Demo({ position }: { position: "bottom" | "top" }) {
  useEffect(() => () => toast.clear(), []);
  return (
    <Stack>
      <Row>
        <Button onClick={() => toast(`Copied for agent (${++n})`)}>Show toast</Button>
        <Button
          onClick={() =>
            toast(
              <>
                <b style={{ fontWeight: 500 }}>PRO-5</b> saved on mobile ·{" "}
                <span className="mono">entries/005-avatar-cropped.md</span>
              </>,
            )
          }
        >
          Rich content
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            for (let i = 0; i < 5; i++) toast(`Burst ${i + 1} of 5`);
          }}
        >
          Burst of 5 (only 3 stay)
        </Button>
      </Row>
      <div style={{ font: "12px var(--sans)", color: "var(--fg-3)" }}>
        Each lasts 2.8s; hovering pauses it. The oldest is dropped past three.
      </div>
      <Toaster position={position} />
    </Stack>
  );
}

export const Bottom: Story = { render: () => <Demo position="bottom" /> };
export const Top: Story = { render: () => <Demo position="top" /> };
