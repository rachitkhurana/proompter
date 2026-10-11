// Served at /redact. Cards with typed values and a marked block, for the snapshot redaction e2e (D17). The page is
// taller than the window so it can scroll, and a fixed panel holds a field (its position is not the page's once scrolled).
const box = { background: "#fff", color: "#111", display: "grid", gap: 16 } as const;
const field = { padding: 8, border: "2px solid #f0f", font: "16px system-ui", background: "#fff", color: "#111" } as const;

export default function Page() {
  return (
    <main style={{ padding: 40, minHeight: 2000, fontFamily: "system-ui, sans-serif" }}>
      <div data-testid="redact-card" style={{ ...box, width: 360, padding: 24 }}>
        <input data-testid="redact-input" aria-label="Secret" defaultValue="hunter2-secret" style={field} />
        <div data-testid="redact-block" data-proompter-redact="" style={{ height: 48, background: "#e11", color: "#fff", padding: 8 }}>
          card 4242 4242 4242 4242
        </div>
      </div>
      {/* A grid card with fluid width and auto margins: layouts html-to-image does not reproduce faithfully. */}
      <div
        data-testid="fluid-card"
        style={{ ...box, marginTop: 40, boxSizing: "content-box", padding: 16, border: "1px solid #ccc" }}
      >
        <input
          data-testid="fluid-right"
          aria-label="Right"
          defaultValue="right"
          style={{ ...field, width: 120, marginLeft: "auto" }}
        />
        <input
          data-testid="fluid-center"
          aria-label="Centre"
          defaultValue="centre"
          style={{ ...field, width: 200, margin: "0 auto", textAlign: "center" }}
        />
      </div>
      <div style={{ position: "fixed", right: 16, bottom: 16, padding: 12, background: "#fff" }}>
        <input data-testid="panel-input" aria-label="Panel" defaultValue="panel secret" style={field} />
      </div>
    </main>
  );
}
