import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "../icons";
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
        <Chip icon={<Icon name="tag" size="s" />}>Static</Chip>
        <Chip as="button" icon={<Icon name="tag" size="s" />}>
          Button
        </Chip>
        <Chip mono>post-card.tsx:48</Chip>
        <Chip mono as="button">
          ↳ avatar.tsx:12
        </Chip>
        <Chip accent icon={<Icon name="code" size="s" />}>
          T-feed-home
        </Chip>
        <Chip ghost icon={<Icon name="responsive" size="s" />}>
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
      <Kbd>⌘⇧K</Kbd>
      <Kbd>Esc</Kbd>
    </Row>
  ),
};

export const PriorityAndStatus: Story = {
  render: () => (
    <Stack>
      <Row>
        <PriorityIcon priority="blocking" />
        <PriorityIcon priority="important" />
        <PriorityIcon priority="minor" />
      </Row>
      <Row>
        <StatusIcon status="open" />
        <StatusIcon status="progress" />
        <StatusIcon status="resolved" />
      </Row>
    </Stack>
  ),
};
