export function Spread(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className="x">
      <span {...props} />
    </div>
  );
}
