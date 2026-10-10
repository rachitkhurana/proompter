import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Icon } from "../icons";
import { Segmented } from "./segmented";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Row, Stack, shadowOf } from "./story-frame";
import { TooltipProvider } from "./tooltip";

const meta: Meta = { title: "Primitives/Segmented", component: Segmented };
export default meta;
type Story = StoryObj;

const viewports = [
  { value: "responsive", label: "Responsive", icon: <Icon name="responsive" />, tooltip: "Responsive  1" },
  { value: "desktop", label: "Desktop", icon: <Icon name="desktop" />, tooltip: "Desktop  2" },
  { value: "tablet", label: "Tablet", icon: <Icon name="tablet" />, tooltip: "Tablet  3" },
  { value: "mobile", label: "Mobile", icon: <Icon name="mobile" />, tooltip: "Mobile  4" },
] as const;

function Demo() {
  const [vp, setVp] = useState<string>("responsive");
  const [tab, setTab] = useState<string>("entries");
  return (
    <TooltipProvider>
      <Stack>
        <Row>
          <Segmented
            label="Viewport"
            items={viewports}
            value={vp}
            onValueChange={setVp}
            tooltipSide="top"
          />
          <Segmented
            label="Viewport (vertical)"
            orientation="vertical"
            items={viewports}
            value={vp}
            onValueChange={setVp}
            tooltipSide="right"
          />
        </Row>
        <div style={{ width: 300 }}>
          <Segmented
            label="Sheet"
            variant="text"
            items={[
              { value: "entries", label: "Entries", count: 4 },
              { value: "publish", label: "Publish" },
            ]}
            value={tab}
            onValueChange={setTab}
          />
        </div>
        <div style={{ font: "12px var(--sans)", color: "var(--fg-3)" }}>
          Tab to the group, then use the arrow keys. Home and End jump to the ends.
        </div>
      </Stack>
    </TooltipProvider>
  );
}

export const States: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const shadow = await shadowOf(canvasElement);
    const group = (await within(shadow as unknown as HTMLElement).findAllByRole("radiogroup"))[0]!;
    const radios = within(group).getAllByRole("radio");
    radios[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(radios[1]!.getAttribute("aria-checked")).toBe("true"));
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(radios[3]!.getAttribute("aria-checked")).toBe("true"));
  },
};
