import { Avatar } from "./avatar";

export function App() {
  return (
    <main style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Vite example</h1>
      <article style={{ display: "flex", gap: 12, alignItems: "center", padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <Avatar />
        <div>
          <strong>Maya</strong>
          <p style={{ margin: "4px 0 0" }}>Shipped the new onboarding today.</p>
        </div>
      </article>
    </main>
  );
}
