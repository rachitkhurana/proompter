import { DockHarness } from "@rachitkay/proompter/internal/fixtures";

// Served at /fixtures/dock. The dock is mounted inside Proompter's shadow root with no other wiring.
export default function Page() {
  return (
    <main style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Dock fixture</h1>
      <DockHarness />
    </main>
  );
}
