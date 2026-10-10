import { Avatar } from "./avatar";

function FeedTabs() {
  return (
    <div className="h-tabs">
      <button className="on" type="button">
        For you
      </button>
      <button type="button">Following</button>
    </div>
  );
}

function ComposeCard() {
  return (
    <div className="h-card h-compose">
      <Avatar />
      <div className="h-input">Share a clip, a win, or a hot take…</div>
    </div>
  );
}

function PostHeader() {
  return (
    <div className="h-post-top">
      <Avatar tone="b" testId="post-avatar" />
      <div>
        <strong>kairo</strong>
        <small>Valorant · 14 min ago</small>
      </div>
    </div>
  );
}

function MediaPreview() {
  return <div className="h-media">Clutch 1v4 · Ascent</div>;
}

function PostActions() {
  return (
    <div className="h-acts">
      <button type="button">♥ 128</button>
      <button type="button">Comment 24</button>
      <button type="button">Share</button>
    </div>
  );
}

function PostCard() {
  return (
    <article className="h-card h-post" data-testid="post-card">
      <PostHeader />
      <p>Clutched a 1v4 on Ascent with the Sheriff. Teammates were already typing &quot;ff&quot; in chat.</p>
      <MediaPreview />
      <PostActions />
    </article>
  );
}

const STANDINGS: Array<[number, string, number, number]> = [
  [1, "Nightfall Five", 31, 74],
  [2, "#1042", 27, 66],
  [3, "Ronin Club", 22, 58],
];

function StandingsRow({ row }: { row: [number, string, number, number] }) {
  return (
    <tr>
      <td>{row[0]}</td>
      <td>{row[1]}</td>
      <td className="num">{row[2]}</td>
      <td className="num">{row[3]}</td>
    </tr>
  );
}

function StandingsPanel() {
  return (
    <table className="h-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Squad</th>
          <th className="num">Kills</th>
          <th className="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {STANDINGS.map((row) => (
          <StandingsRow key={row[0]} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function EntityCard() {
  return (
    <section className="h-card h-tour">
      <div className="h-tour-head">
        <span className="h-live">
          <i></i>Live · Round 3
        </span>
        <span className="h-pill">Battle royale · 16 squads</span>
      </div>
      <h3>Valorant Night Cup</h3>
      <small>Hosted by Nightfall Esports · prize pool ₹25,000</small>
      <StandingsPanel />
    </section>
  );
}

function PostSkeleton() {
  return (
    <div className="h-card h-skel">
      <i></i>
      <i></i>
      <i></i>
    </div>
  );
}

export function FeedColumn() {
  return (
    <main className="h-main">
      <div className="h-head">
        <h1>Feed</h1>
        <FeedTabs />
      </div>
      <ComposeCard />
      <PostCard />
      <EntityCard />
      <PostSkeleton />
    </main>
  );
}
