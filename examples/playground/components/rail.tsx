import { Avatar } from "./avatar";

function TrendingRail() {
  const rows: Array<["" | "b" | "c", string, string]> = [
    ["c", "Ronin Club", "2.4k members"],
    ["", "BGMI India", "18.1k members"],
    ["b", "Clip Kitchen", "6.7k members"],
  ];
  return (
    <div className="h-card">
      <h4>Trending communities</h4>
      <div className="h-list">
        {rows.map(([tone, name, members]) => (
          <div className="h-row" key={name}>
            <Avatar tone={tone} />
            <div>
              <strong>{name}</strong>
              <small>{members}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TournamentStatus() {
  return (
    <div className="h-card">
      <h4>Your tournaments</h4>
      <div className="h-list">
        <div className="h-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Monsoon Scrims</strong>
            <small>Ended 2 days ago</small>
          </div>
          <span className="h-pill lock">Changes locked</span>
        </div>
        <div className="h-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Valorant Night Cup</strong>
            <small>Round 3 of 4</small>
          </div>
          <span className="h-pill">Organiser</span>
        </div>
      </div>
    </div>
  );
}

export function Rail() {
  return (
    <aside className="h-rail">
      <TrendingRail />
      <TournamentStatus />
    </aside>
  );
}
