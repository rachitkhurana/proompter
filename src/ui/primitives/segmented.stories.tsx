import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DesktopIcon, MobileIcon, ResponsiveIcon, TabletIcon } from "../icons";
import { Segmented } from "./segmented";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Row, Stack, shadowOf } from "./story-frame";

const meta: Meta = { title: "Primitives/Segmented", component: Segmented };
export default meta;
type Story = StoryObj;

const viewports = [
  { value: "responsive", label: "Responsive", icon: <ResponsiveIcon />, tooltip: "Responsive  1" },
  { value: "desktop", label: "Desktop", icon: <DesktopIcon />, tooltip: "Desktop  2" },
  { value: "tablet", label: "Tablet", icon: <TabletIcon />, tooltip: "Tablet  3" },
  { value: "mobile", label: "Mobile", icon: <MobileIcon />, tooltip: "Mobile  4", disabled: false },
] as const;

function Demo() {
  const [vp, setVp] = useState<string>("responsive");
  const [tab, setTab] = useState<string>("entries");
  return (
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
        <Segmented
          label="Viewport (one disabled)"
          items={viewports.map((v) => (v.value === "tablet" ? { ...v, disabled: true } : v))}
          value={vp}
          onValueChange={setVp}
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
