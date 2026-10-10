export const Pick = <T,>({ items }: { items: T[] }) => (
  <ul>
    {items.map((_, i) => (
      <li key={i} />
    ))}
  </ul>
);

export function List<T>({ items }: { items: T[] }) {
  return <ol>{items.length as number}</ol>;
}

export const Typed = (x: unknown) => <p>{(x as string)!}</p>;
