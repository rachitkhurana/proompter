import { PickHarness } from "./harness";

/**
 * T04 test fixture (owned by T04; T10's playground port makes it redundant). A feed with two identical,
 * hand-stamped cards, so the e2e can pick an avatar and check that the selector tells the cards apart.
 * The `data-src` / `data-comp` attributes are what the Next loader would stamp.
 */

export const metadata = { title: "Proompter pick fixture" };

const F = "app/fixtures/pick/page.tsx";
const AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%2352525b'/%3E%3C/svg%3E";

function Card({ n }: { n: number }) {
  return (
    <article data-src={`${F}:20:5`} data-comp="PostCard" className="card" data-testid={`card-${n}`}>
      <header data-src={`${F}:22:7`} className="head">
        <div data-src={`${F}:23:9`} data-comp="Avatar">
          <img data-src={`${F}:24:11`} className="avatar" alt="avatar" width={40} height={40} src={AVATAR} data-testid={`avatar-${n}`} />
        </div>
        <span data-src={`${F}:26:9`}>Player {n}</span>
      </header>
      <p data-src={`${F}:28:7`}>Clutched a 1v4 against the whole lobby</p>
    </article>
  );
}

export default function Page() {
  return (
    <>
      <style>{`
        body{margin:0;background:#fff;color:#18181b;font:15px/22px system-ui,sans-serif}
        main{max-width:420px;margin:0 auto;padding:24px 16px}
        h1{font-size:20px;margin:0 0 16px}
        .card{border:1px solid #e4e4e7;border-radius:12px;padding:12px 16px;margin-bottom:16px}
        .head{display:flex;gap:12px;align-items:center}
        .avatar{display:block;border-radius:50%}
        p{margin:8px 0 0}
      `}</style>
      <main data-src={`${F}:40:5`} data-comp="PickFixture">
        <h1 data-src={`${F}:41:7`}>Pick fixture</h1>
        <Card n={1} />
        <Card n={2} />
      </main>
      <PickHarness />
    </>
  );
}
