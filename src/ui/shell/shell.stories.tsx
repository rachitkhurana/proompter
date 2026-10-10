import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Proompter } from "../proompter";
import { createFakeDeps } from "./fake";

/**
 * The whole kit on a story page, with the in-memory store and a bare composer. `⌘⇧K`, `E`, `P`, `1`-`4`
 * and `Esc` all work. (Inside a story the kit sits in a second shadow root, so the picker finds nothing to
 * pick on the page; use the playground's /fixtures/kit for that.)
 */
const meta: Meta = {
  title: "Shell/Proompter",
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
};
export default meta;
type Story = StoryObj;

function Kit({ empty }: { empty?: boolean }) {
  const [deps] = useState(() => createFakeDeps(empty ? { entries: [] } : undefined));
  return <Proompter defaultOpen deps={deps} session={{ reviewer: "rachit" }} />;
}

export const Seeded: Story = { render: () => <Kit /> };
export const Empty: Story = { render: () => <Kit empty /> };
