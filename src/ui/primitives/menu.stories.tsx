import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ApproveIcon, ChangeIcon, FixIcon, QuestionIcon, TagIcon } from "../icons";
import { useShadowContainer } from "../shadow-root";
import { Chip } from "./chip";
import { Kbd } from "./kbd";
import { Menu, type MenuItem } from "./menu";
import { PRIORITY_LABEL, PriorityIcon, type Priority } from "./priority-icon";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Row, Stack, shadowOf } from "./story-frame";

const meta: Meta = { title: "Primitives/Menu", component: Menu };
export default meta;
type Story = StoryObj;

const hint = { font: "12px var(--sans)", color: "var(--fg-3)", maxWidth: 360 } as const;

const intents = [
  { key: "fix", label: "Fix", icon: <FixIcon size="s" /> },
  { key: "change", label: "Change", icon: <ChangeIcon size="s" /> },
  { key: "question", label: "Question", icon: <QuestionIcon size="s" /> },
  { key: "approve", label: "Looks good", icon: <ApproveIcon size="s" /> },
];

function SingleSelect() {
  const [intent, setIntent] = useState("fix");
  const items: MenuItem[] = intents.map((i) => ({ ...i, checked: i.key === intent }));
  const current = intents.find((i) => i.key === intent);
  return (
    <Stack>
      <Menu
        trigger={
          <Chip as="button" icon={current?.icon}>
            {current?.label}
          </Chip>
        }
        items={items}
        selection="single"
        onSelect={setIntent}
      />
      <div style={hint}>
        Single select. Enter or ArrowDown on the chip opens it; arrows move (and wrap), Enter picks and
        closes, Esc closes and returns focus to the chip.
      </div>
    </Stack>
  );
}

export const SingleSelectIntent: Story = {
  render: () => <SingleSelect />,
  // Keyboard navigation: open, land on item 0, arrow down, pick with Enter.
  play: async ({ canvasElement }) => {
    const shadow = await shadowOf(canvasElement);
    const s = within(shadow as unknown as HTMLElement);
    const trigger = await s.findByRole("button", { name: /fix/i });
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    const items = await s.findAllByRole("menuitemradio");
    await waitFor(() => expect(shadow.activeElement).toBe(items[0]));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(shadow.activeElement).toBe(items[1]));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(s.getByRole("button", { name: /change/i })).toBeTruthy());
  },
};

const TAGS = ["ui", "data", "copy", "a11y", "perf", "regression", "mobile"];

function MultiSelect() {
  const [tags, setTags] = useState<string[]>(["ui"]);
  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  return (
    <Stack>
      <Menu
        header="Tags"
        trigger={
          <Chip as="button" icon={<TagIcon size="s" />}>
            {tags.length ? tags.join(", ") : "Tags"}
          </Chip>
        }
        items={TAGS.map((t) => ({ key: t, label: t, icon: <TagIcon size="s" />, checked: tags.includes(t) }))}
        selection="multiple"
        onSelect={toggle}
      />
      <div style={hint}>
        Multi select: the menu stays open while you toggle tags with Enter or Space. Esc closes.
      </div>
    </Stack>
  );
}

export const MultiSelectTags: Story = { render: () => <MultiSelect /> };

function PriorityMenu() {
  const [p, setP] = useState<Priority>("important");
  return (
    <Menu
      trigger={
        <Chip as="button" icon={<PriorityIcon priority={p} />}>
          {PRIORITY_LABEL[p]}
        </Chip>
      }
      items={(Object.keys(PRIORITY_LABEL) as Priority[]).map((k) => ({
        key: k,
        label: PRIORITY_LABEL[k],
        icon: <PriorityIcon priority={k} />,
        checked: k === p,
      }))}
      selection="single"
      onSelect={(k) => setP(k as Priority)}
    />
  );
}

export const WithPriorityIcons: Story = { render: () => <PriorityMenu /> };

export const ActionsWithShortcuts: Story = {
  render: () => (
    <Menu
      trigger={<Chip as="button">Actions</Chip>}
      items={[
        { key: "copy", label: "Copy for agent", shortcut: <Kbd>⇧C</Kbd> },
        { key: "show", label: "Show on page", shortcut: <Kbd>S</Kbd> },
        { key: "resolve", label: "Resolve", shortcut: <Kbd>⌘↵</Kbd> },
        { key: "gone", label: "Unavailable", disabled: true },
      ]}
      onSelect={() => {}}
    />
  ),
};

function PortalProbe() {
  const container = useShadowContainer();
  const [report, setReport] = useState("Open the menu to check where it renders.");
  const check = (open: boolean) => {
    if (!open) return;
    // The content mounts after the open state commits.
    setTimeout(() => {
      const el = container?.querySelector('[role="menu"]');
      const inLight = document.querySelector('[role="menu"]');
      setReport(
        el
          ? `menu is inside the shadow root (root node: ${el.getRootNode() instanceof ShadowRoot ? "ShadowRoot" : "Document"}); in light DOM: ${inLight ? "yes (bug)" : "no"}`
          : "menu not found in the shadow container",
      );
    }, 50);
  };
  return (
    <Stack>
      <Menu
        trigger={<Chip as="button">Open menu</Chip>}
        items={[
          { key: "a", label: "First" },
          { key: "b", label: "Second" },
        ]}
        onSelect={() => {}}
        onOpenChange={check}
      />
      <Row>
        <div role="status" style={{ ...hint, color: "var(--fg-2)" }}>
          {report}
        </div>
      </Row>
    </Stack>
  );
}

export const PortalsIntoShadowRoot: Story = { render: () => <PortalProbe /> };

export const OriginAwareNearEdge: Story = {
  name: "Origin-aware scale-in (open near the bottom: it flips and grows upward)",
  render: () => (
    <div style={{ height: "70vh", display: "flex", alignItems: "flex-end" }}>
      <Menu
        trigger={<Chip as="button">Open upward</Chip>}
        items={intents.map((i) => ({ ...i }))}
        onSelect={() => {}}
      />
    </div>
  ),
};
