// A server component: no directive, async, gets stamped like any other.
export default async function Page() {
  const items = await Promise.resolve(["a", "b"]);
  return (
    <main>
      {items.map((i) => (
        <p key={i}>{i}</p>
      ))}
    </main>
  );
}
