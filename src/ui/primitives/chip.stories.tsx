import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeIcon, ResponsiveIcon, TagIcon } from "../icons";
import { Chip } from "./chip";
import { Kbd } from "./kbd";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";
import { Caption, Row, Stack } from "./story-frame";

const meta: Meta = { title: "Primitives/Chip, Kbd, icons", component: Chip };
export default meta;
type Story = StoryObj;

export const Chips: Story = {
  render: () => (
    <Stack>
      <Row>
        <Chip icon={<TagIcon size="s" />}>Static</Chip>
        <Chip as="button" icon={<TagIcon size="s" />}>
          Button
        </Chip>
        <Chip mono>post-card.tsx:48</Chip>
        <Chip mono as="button">
          ↳ avatar.tsx:12
        </Chip>
        <Chip accent icon={<CodeIcon size="s" />}>
          T-feed-home
        </Chip>
        <Chip ghost icon={<ResponsiveIcon size="s" />}>
          1280×800
        </Chip>
      </Row>
      <div style={{ width: 140 }}>
        <Caption>truncates inside a narrow box</Caption>
        <Chip as="button">A very long property value that must truncate</Chip>
      </div>
    </Stack>
  ),
};

export const KbdKeys: Story = {
  render: () => (
    <Row>
      <Kbd>P</Kbd>
      <Kbd>⌘</Kbd>
      <Kbd>⌘K</Kbd>
      <Kbd>Esc</Kbd>
    </Row>
  ),
};

export const PriorityAndStatus: Story = {
  render: () => (
    <Stack>
      <Row>
        <PriorityIcon priority="blocking" label="Blocking" />
        <PriorityIcon priority="important" label="Important" />
        <PriorityIcon priority="minor" label="Minor" />
      </Row>
      <Row>
        <StatusIcon status="open" label="Open" />
        <StatusIcon status="progress" label="In progress" />
        <StatusIcon status="resolved" label="Resolved" />
      </Row>
    </Stack>
  ),
};
