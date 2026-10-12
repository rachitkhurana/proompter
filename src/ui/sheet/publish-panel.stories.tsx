import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DEFAULT_TAGS } from "../labels";
import type { GithubStatus, GithubSyncOutcome } from "../proompter-deps";
import { createFakeDeps, seedEntries } from "../shell/fake";
import { Sheet } from "./sheet";

/** The Publish tab with GitHub sync on (D16): every state the section can be in. */
const meta: Meta = {
  title: "Shell/Publish tab (GitHub)",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const URLS = {
  "PRO-1": "https://github.com/acme/reviews/issues/481",
  "PRO-2": "https://github.com/acme/reviews/issues/482",
};

function Harness({ status, outcome, githubOnly }: { status: GithubStatus; outcome?: GithubSyncOutcome; githubOnly?: boolean }) {
  const [deps] = useState(() => createFakeDeps({ written: true }));
  const { session } = deps.store.getSnapshot();
  const entries = seedEntries().map((e) => (e.n === 2 ? { ...e, issue: "482" } : e));
  return (
    <Sheet
      open
      side="right"
      session={session}
      entries={entries}
      pending={[]}
      tab="publish"
      onTabChange={() => {}}
      selectedId={null}
      onSelect={() => {}}
      onClose={() => {}}
      onWrite={githubOnly ? undefined : () => Promise.resolve()}
      github={{ status, onSync: () => Promise.resolve(outcome ?? { ok: true, synced: 0, resolved: 0 }) }}
      ticket={{
        serialize: (e) => deps.serialize(e, session),
        entryPath: (e) => deps.entryPath(e, session),
        tagOptions: DEFAULT_TAGS,
        planOptions: [],
        onShow: () => {},
        onUpdate: () => {},
        onResolve: () => {},
      }}
    />
  );
}

const base: GithubStatus = { pending: 0, error: null, needsKey: false, urls: {} };

/** Nothing sent yet: the rows have no issue. */
export const NotSynced: Story = { render: () => <Harness status={{ ...base, pending: 4 }} /> };

/** Issues exist: the number is a link. The status line says everything is synced. */
export const Synced: Story = { render: () => <Harness status={{ ...base, urls: URLS }} /> };

/** The route answered 401: the key field shows. */
export const KeyNeeded: Story = {
  render: () => <Harness status={{ ...base, pending: 4, needsKey: true, error: "Enter the review key to sync with GitHub" }} />,
};

/** The host has no GitHub route (404). */
export const NotSetUp: Story = {
  render: () => <Harness status={{ ...base, pending: 4, error: "GitHub sync isn't set up on this server" }} />,
};

/** `save="github"`: no files sink, so the Files section is gone. */
export const GithubOnly: Story = { render: () => <Harness status={{ ...base, urls: URLS }} githubOnly /> };
