import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../../core/entry";
import type { GithubStatus, GithubSyncOutcome } from "../proompter-deps";
import { toast } from "../primitives/toast";
import { fakeEntryPath, fakeSerialize, SEED_SESSION, seedEntries } from "../shell/fake";
import { mountInShadow, type Mounted } from "../test-utils";
import { Sheet, type SheetProps } from "./sheet";

let m: Mounted;
afterEach(async () => {
  await m?.unmount();
  toast.clear();
});
const mount = async (ui: ReactNode) => {
  m = await mountInShadow(ui, { css: "" });
};
const q = <T extends Element = HTMLElement>(sel: string) => m.shadow().querySelector<T>(sel);
const button = (name: string) => Array.from(m.shadow().querySelectorAll<HTMLElement>("button")).find((b) => b.textContent?.includes(name));

const base: GithubStatus = { pending: 0, error: null, needsKey: false, urls: {} };
function sheet(status: GithubStatus, onSync: (key?: string) => Promise<GithubSyncOutcome>, entries: Entry[] = seedEntries()): SheetProps {
  return {
    open: true,
    side: "right",
    session: SEED_SESSION,
    entries,
    pending: [],
    tab: "publish",
    onTabChange: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    github: { status, onSync },
    ticket: {
      serialize: (e) => fakeSerialize(e, SEED_SESSION),
      entryPath: (e) => fakeEntryPath(e, SEED_SESSION),
      tagOptions: [],
      planOptions: [],
      onShow: vi.fn(),
      onUpdate: vi.fn(),
      onResolve: vi.fn(),
    },
  };
}
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("Publish tab with GitHub sync", () => {
  it("without the github prop the v2 preview section is unchanged", async () => {
    await mount(<Sheet {...sheet(base, vi.fn())} github={undefined} />);
    expect(q("#pm-pub-issues")?.textContent).toContain("v2");
    expect(button("Sync to GitHub")).toBeUndefined();
  });

  it("shows each entry's issue as a link when the url is known", async () => {
    const entries = seedEntries().map((e) => (e.n === 2 ? { ...e, issue: "482" } : e));
    await mount(<Sheet {...sheet({ ...base, urls: { "PRO-2": "https://github.com/acme/reviews/issues/482" } }, vi.fn(), entries)} />);
    const link = q<HTMLAnchorElement>(".irow a");
    expect(link?.textContent).toBe("#482");
    expect(link?.getAttribute("href")).toBe("https://github.com/acme/reviews/issues/482");
    expect(link?.rel).toContain("noreferrer");
    expect(q("[role=status]")?.textContent).toBe("Everything is synced.");
  });

  it("syncs, then says how many entries went up and how many were resolved", async () => {
    const onSync = vi.fn(() => Promise.resolve({ ok: true, synced: 3, resolved: 1 }));
    await mount(<Sheet {...sheet({ ...base, pending: 3 }, onSync)} />);
    expect(q("[role=status]")?.textContent).toBe("3 entries to sync");
    await act(async () => button("Sync to GitHub")!.click());
    expect(onSync).toHaveBeenCalledWith(undefined);
    expect(q("[role=status]")?.textContent).toBe("Synced 3 entries, 1 resolved from GitHub");
  });

  it("shows the error, and asks for the key after a 401, then syncs again with it", async () => {
    const onSync = vi
      .fn<(key?: string) => Promise<GithubSyncOutcome>>()
      .mockResolvedValueOnce({ ok: true, synced: 1, resolved: 0 });
    const status: GithubStatus = { ...base, pending: 1, needsKey: true, error: "Enter the review key to sync with GitHub" };
    await mount(<Sheet {...sheet(status, onSync)} />);
    expect(q("[role=status]")?.className).toBe("pm-err");
    const input = q<HTMLInputElement>("input[aria-label='Review key']")!;
    expect(input.type).toBe("password");
    await type(input, "  secret  ");
    await act(async () => button("Save and sync")!.click());
    expect(onSync).toHaveBeenCalledWith("secret");
    expect(q("[role=status]")?.textContent).toBe("Synced 1 entry");
  });

  it("no key field unless the route said 401, and a failed sync shows its message", async () => {
    const onSync = vi.fn(() => Promise.resolve({ ok: false, synced: 0, resolved: 0, error: "GitHub sync isn't set up on this server" }));
    await mount(<Sheet {...sheet(base, onSync)} />);
    expect(q("input[aria-label='Review key']")).toBeNull();
    await act(async () => button("Sync to GitHub")!.click());
    expect(q("[role=status]")?.textContent).toBe("GitHub sync isn't set up on this server");
  });
});
