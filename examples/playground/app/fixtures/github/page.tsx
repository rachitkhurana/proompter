import { GithubHarness } from "./harness";

/**
 * T12 test fixture: a plain page with the real `<Proompter github>` on it. The e2e files entries here and syncs
 * them to the fake GitHub (scripts/e2e-servers.mjs, BASE+5). Dev and preview builds only, like the other fixtures.
 */

export const metadata = { title: "Proompter GitHub fixture" };

export default function Page() {
  return (
    <>
      <style>{`
        body{margin:0;background:#fff;color:#18181b;font:15px/22px system-ui,sans-serif}
        main{max-width:420px;margin:0 auto;padding:24px 16px}
        .card{border:1px solid #e4e4e7;border-radius:12px;padding:12px 16px}
      `}</style>
      <main data-src="app/fixtures/github/page.tsx:20:7" data-comp="GithubFixture">
        <h1>GitHub fixture</h1>
        <section className="card" data-src="app/fixtures/github/page.tsx:22:9" data-comp="Card" data-testid="card">
          Clutched a 1v4 against the whole lobby
        </section>
      </main>
      <GithubHarness />
    </>
  );
}
