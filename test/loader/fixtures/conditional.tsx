export function Either({ ok }: { ok: boolean }) {
  return ok ? <a href="#">yes</a> : <button>no</button>;
}

export function Maybe({ show }: { show: boolean }) {
  return show && <aside>hi</aside>;
}

export function Early({ items }: { items: string[] }) {
  if (items.length === 0) return <p>empty</p>;
  return (
    <ul>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function Inline({ on }: { on: boolean }) {
  return (
    <div>
      {on && <span>on</span>}
      {on ? <i>a</i> : <u>b</u>}
    </div>
  );
}
