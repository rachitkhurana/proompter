import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "../icons";
import { Button, IconButton } from "./button";
import { Kbd } from "./kbd";
import { Caption, Row, Stack } from "./story-frame";

const meta: Meta = { title: "Primitives/Button", component: Button };
export default meta;
type Story = StoryObj;

export const Variants: Story = {
  render: () => (
    <Stack>
      <div>
        <Caption>md</Caption>
        <Row>
          <Button>Default</Button>
          <Button variant="pri">Create entry</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="pri">
            Create <Kbd>⌘↵</Kbd>
          </Button>
        </Row>
      </div>
      <div>
        <Caption>sm</Caption>
        <Row>
          <Button size="sm">Default</Button>
          <Button size="sm" variant="pri">
            Resolve
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
        </Row>
      </div>
      <div>
        <Caption>disabled (aria-disabled, still focusable)</Caption>
        <Row>
          <Button disabled>Default</Button>
          <Button variant="pri" disabled>
            Primary
          </Button>
          <Button variant="ghost" disabled>
            Ghost
          </Button>
        </Row>
      </div>
      <div>
        <Caption>with icon</Caption>
        <Row>
          <Button>
            <Icon name="copy" size="s" /> Copy for agent
          </Button>
          <Button variant="pri">
            <Icon name="publish" size="s" /> Publish
          </Button>
        </Row>
      </div>
    </Stack>
  ),
};

/** Press Tab: each control shows the 2px coral focus ring (`:focus-visible`, offset 2px). */
export const FocusRing: Story = {
  render: () => (
    <Row>
      <Button>Tab to me</Button>
      <Button variant="pri">And me</Button>
      <IconButton label="Pick element">
        <Icon name="pick" />
      </IconButton>
    </Row>
  ),
};

export const IconButtons: Story = {
  render: () => (
    <Row>
      <IconButton label="Pick element">
        <Icon name="pick" />
      </IconButton>
      <IconButton label="Pick element (on)" pressed>
        <Icon name="pick" />
      </IconButton>
      <IconButton label="Pick element (off)" pressed={false}>
        <Icon name="pick" />
      </IconButton>
      <IconButton label="Disabled" disabled>
        <Icon name="pick" />
      </IconButton>
      <IconButton label="Entries, 4 open" badge={4}>
        <Icon name="copy" />
      </IconButton>
    </Row>
  ),
};
