const NAV = ["Feed", "Communities", "Tournaments", "Events", "Messages"];

function NavItem({ label, on }: { label: string; on?: boolean }) {
  return (
    <a href="#" className={on ? "on" : undefined}>
      <span></span>
      {label}
    </a>
  );
}

function VoiceChip() {
  return (
    <div className="h-voice">
      <div className="h-eq">
        <i></i>
        <i></i>
        <i></i>
      </div>
      <div>
        <b>In voice</b>
        <small>Squad Room · 4</small>
      </div>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="h-side">
      <div className="h-logo">
        <i></i>gamorite
      </div>
      <nav className="h-nav">
        {NAV.map((label, i) => (
          <NavItem key={label} label={label} on={i === 0} />
        ))}
      </nav>
      <VoiceChip />
    </aside>
  );
}
