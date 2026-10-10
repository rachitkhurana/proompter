import type { Meta, StoryObj } from "@storybook/react-vite";
import { PickIcon, MultiIcon, AreaIcon, TextIcon } from "../icons";
import { IconButton } from "./button";
import { Kbd } from "./kbd";
import { Row, Stack } from "./story-frame";
import { Tooltip, TooltipProvider } from "./tooltip";

const meta: Meta = { title: "Primitives/Tooltip", component: Tooltip };
export default meta;
type Story = StoryObj;

export const WarmHover: Story = {
  name: "350ms first, instant while warm",
  render: () => (
    <TooltipProvider>
      <Stack>
        <Row>
          <Tooltip content={<>Pick element <Kbd>P</Kbd></>}>
            <IconButton label="Pick element">
              <PickIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content={<>Select several <Kbd>M</Kbd></>}>
            <IconButton label="Select several">
              <MultiIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content={<>Box select <Kbd>B</Kbd></>}>
            <IconButton label="Box select">
              <AreaIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Disabled tooltip" disabled>
            <IconButton label="No tooltip">
              <TextIcon />
            </IconButton>
          </Tooltip>
        </Row>
        <div style={{ font: "12px var(--sans)", color: "var(--fg-3)" }}>
          Hover the first button and wait, then sweep across the others. Keyboard focus shows them too; Esc
          hides.
        </div>
      </Stack>
    </TooltipProvider>
  ),
};

export const Sides: Story = {
  render: () => (
    <Row style={{ justifyContent: "center", padding: "48px 80px" }}>
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <Tooltip key={side} content={`Opens ${side}`} side={side}>
          <IconButton label={`Tooltip ${side}`}>
            <PickIcon />
          </IconButton>
        </Tooltip>
      ))}
    </Row>
  ),
};
