"use client";

import { Dialog } from "radix-ui";

// Served at /dialog. A modal Radix Dialog, as host apps use them (Gamorite's Settings): focus trap, scroll lock,
// outside-click and Esc dismissal, aria-hidden on everything else. The kit must work inside it (D11).
export default function Page() {
  return (
    <main style={{ minHeight: "150vh", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Dialog fixture</h1>
      <Dialog.Root>
        <Dialog.Trigger>Open settings</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)" }} />
          <Dialog.Content
            aria-describedby={undefined}
            style={{ position: "fixed", left: "50%", top: "30%", translate: "-50% 0", padding: 24, background: "#fff" }}
          >
            <Dialog.Title>Settings</Dialog.Title>
            <p data-testid="dialog-field">Display name</p>
            <input aria-label="Display name" defaultValue="rachit" />
            <Dialog.Close>Close</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
