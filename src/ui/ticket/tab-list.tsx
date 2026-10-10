import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
}

export interface TabListProps<V extends string> {
  items: ReadonlyArray<TabItem<V>>;
  value: V;
  onValueChange: (v: V) => void;
  label: string;
}

/** The small text tabs of the Captured context section (`.ctabs`). One tab stop; arrows move and select. */
export function TabList<V extends string>({ items, value, onValueChange, label }: TabListProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onValueChange(item.value);
    refs.current[next]?.focus();
  };
  return (
    <span className="ctabs" role="tablist" aria-label={label}>
      {items.map((it, i) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={on ? "on" : undefined}
            onClick={() => onValueChange(it.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {it.label}
          </button>
        );
      })}
    </span>
  );
}
