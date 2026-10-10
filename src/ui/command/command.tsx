import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { cx } from "../primitives/cx";
import { Kbd } from "../primitives/kbd";
import { useShadowContainer } from "../shadow-root";
import { filterCommands, type CommandItem } from "./items";

export interface CommandProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Every command, unfiltered. Items close the menu themselves (their `run` is what the app does next). */
  items: readonly CommandItem[];
  /** Start with this search (stories and tests). */
  defaultQuery?: string;
  /** Fade and scale in and out (default). Unit tests turn it off. */
  animated?: boolean;
}

const EXIT_MS = 200;

/**
 * The command menu (`⌘K`): a search field over sections of tools, viewports, entries and session actions.
 * Fully keyboard-driven: type to filter, Up/Down to move (looping), Enter to run, Esc to close.
 *
 * It is non-modal on purpose: nothing outside the shadow root is touched (no scroll lock, no `aria-hidden`
 * on the host, no style tags). The focus trap is ours: the search field is the only tab stop, so Tab and
 * Shift+Tab stay on it, and a click on the scrim closes the menu. Esc closes it through the root's Esc
 * order (the menu also closes itself on Esc when used on its own, as in stories).
 */
export function Command({ open, onOpenChange, items, defaultQuery = "", animated = true }: CommandProps) {
  const container = useShadowContainer();
  const returnTo = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  const titleId = useId();

  const shadowActive = () => {
    if (!container?.isConnected) return null;
    return (container.getRootNode() as Document | ShadowRoot | undefined)?.activeElement ?? null;
  };

  // Remember who had focus before the search field takes it (layout effects run before the field's focus effect).
  useLayoutEffect(() => {
    if (open) {
      const a = shadowActive();
      returnTo.current = a instanceof HTMLElement ? a : null;
      setPhase("open");
      return;
    }
    setPhase((p) => (p === "open" ? (animated ? "closing" : "closed") : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (phase !== "closing") return;
    const t = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Give focus back when the menu closes, unless something else took it meanwhile (running "All entries"
  // focuses the sheet, for one).
  const wasShown = useRef(false);
  useEffect(() => {
    const shown = phase !== "closed";
    if (wasShown.current && !shown) {
      const back = returnTo.current;
      returnTo.current = null;
      const now = shadowActive();
      if (back?.isConnected && (!now || now === container)) back.focus({ preventScroll: true });
    }
    wasShown.current = shown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const state = phase === "open" ? "open" : "closed";
  return (
    <>
      {container && phase !== "closed"
        ? createPortal(
            <>
              <div className="pm-scrim" data-state={state} onPointerDown={() => onOpenChange(false)} />
              <div
                role="dialog"
                aria-modal="false"
                aria-labelledby={titleId}
                className="pm-surface pm-cmd"
                data-state={state}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Tab") {
                    // The search field is the only tab stop: keep focus on it, either direction.
                    e.preventDefault();
                    e.currentTarget.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
                  } else if (e.key === "Escape") {
                    // Mark it handled: the state update flushes before the event reaches the root's document
                    // listener, which would otherwise see "menu closed" and go on to leave the pick mode too.
                    e.preventDefault();
                    onOpenChange(false);
                  }
                }}
              >
                <h2 id={titleId} className="pm-vh">
                  Command menu
                </h2>
                <CommandBody items={items} defaultQuery={defaultQuery} />
              </div>
            </>,
            container,
          )
        : null}
    </>
  );
}

function CommandBody({ items, defaultQuery }: { items: readonly CommandItem[]; defaultQuery: string }) {
  const [query, setQuery] = useState(defaultQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = useMemo(() => filterCommands(items, query), [items, query]);
  const index = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const optionId = (i: number) => `${listId}-o${i}`;
  useEffect(() => {
    const el = inputRef.current?.getRootNode() as Document | ShadowRoot | undefined;
    el?.getElementById?.(optionId(index))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shown]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys that belong to an input method editor (picking a candidate) are not commands.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const n = shown.length;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
      e.preventDefault();
      setActive((index + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Home" && n) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && n) {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[index]?.run();
    }
  };

  // Group the filtered items by section, keeping their flat order for the active index.
  const sections: Array<{ name: string; entries: Array<{ item: CommandItem; i: number }> }> = [];
  shown.forEach((item, i) => {
    let s = sections[sections.length - 1];
    if (!s || s.name !== item.section) {
      s = { name: item.section, entries: [] };
      sections.push(s);
    }
    s.entries.push({ item, i });
  });

  return (
    <>
      <div className="cmd-in">
        <Icon name="search" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optionId(index) : undefined}
          placeholder="Search tools, viewports and entries"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div className="cmd-ls" id={listId} role="listbox" aria-label="Commands">
        {shown.length === 0 ? (
          <div className="empty">Nothing matches “{query}”.</div>
        ) : (
          sections.map((s) => (
            <div key={s.name} role="group" aria-label={s.name}>
              <div className="cmd-sec" aria-hidden="true">
                {s.name}
              </div>
              {s.entries.map(({ item, i }) => (
                <div
                  key={item.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === index}
                  className={cx("cmd-it", i === index && "kb")}
                  onClick={() => item.run()}
                  onPointerMove={() => {
                    if (i !== index) setActive(i);
                  }}
                >
                  <span className="ci">{item.icon}</span>
                  <span>{item.label}</span>
                  <span className="sub">{item.sub}</span>
                  <span className="r">{item.right}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="cmd-ft">
        <span className="logo">
          <Icon name="logo" />
        </span>
        <span className="hint">Proompter</span>
        <span className="sp" />
        <span className="hint">
          Navigate <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </span>
        <span className="hint">
          Run <Kbd>↵</Kbd>
        </span>
      </div>
    </>
  );
}
