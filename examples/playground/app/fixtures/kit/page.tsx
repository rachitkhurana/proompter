import { KitHarness } from "./harness";

/**
 * T08 test fixture (owned by T08). Mounts the full `<Proompter>` (sheet, ticket, command menu, shortcuts)
 * over a small page, with an in-memory store seeded with four entries and a bare composer. The `data-src`
 * values match the seeded entries' selectors, so "Show on page" has something to scroll to.
 */

export const metadata = { title: "Proompter kit fixture" };

export default function Page() {
  return (
    <>
      <style>{`
        body{margin:0;background:#0c0e13;color:#e8eaf0;font:14px/1.5 system-ui,sans-serif}
        main{max-width:640px;margin:0 auto;padding:24px 16px 160px;display:grid;gap:16px}
        .card{background:#141720;border:1px solid #242938;border-radius:14px;padding:16px}
        button{font:inherit}
      `}</style>
      <main data-src="app/fixtures/kit/page.tsx:20:7" data-comp="KitFixture">
        <h1>Kit fixture</h1>
        <section className="card" data-src="standings-panel.tsx:87:5" data-comp="StandingsPanel">
          Standings: 1 Nightfall Five, 2 #1042, 3 Ronin Club
        </section>
        <div className="card" data-src="post-actions.tsx:21:7" data-comp="PostActions">
          <button type="button">♥ 128</button> <button type="button">Comment 24</button>
        </div>
        <div className="card" data-src="voice-chip.tsx:29:5" data-comp="VoiceChip">
          In voice · Squad Room · 4
        </div>
        <div className="card" data-src="feed-tabs.tsx:18:5" data-comp="FeedTabs">
          For you · Following
        </div>
      </main>
      <KitHarness />
    </>
  );
}
