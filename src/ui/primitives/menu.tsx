import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { useShadowContainer } from "../shadow-root";
import { clamp } from "../../core/motion";

export interface MenuItem {
  /** Stable id, passed to `onSelect`. */
  key: string;
  label: string;
  icon?: ReactNode;
  /** Selected state (the menu shows a check). */
  checked?: boolean;
}

export interface MenuProps {
  /** The element that opens the menu (a button or `<Chip as="button">`). It must forward its ref. */
  trigger: ReactElement;
  items: ReadonlyArray<MenuItem>;
  /** Small heading above the items. */
  header?: ReactNode;
  /**
   * `single`: one checked item (radio), the menu closes on select.
   * `multiple`: any number checked (tags), the menu stays open on select.
   */
  selection: "single" | "multiple";
  onSelect: (key: string) => void;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the menu. Falls back to the trigger's. */
  label?: string;
}

const GAP = 6; // trigger to menu (prototype)
const PAD = 8; // viewport edge (prototype)
const EXIT_FALLBACK_MS = 250;
const TYPEAHEAD_MS = 500;

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
}

/**
 * Position `menu` (fixed) below `anchor`, left-aligned with it: flipped above when it would overflow the
 * viewport and above fits, clamped to the viewport edge. Sets `--menu-origin` so the scale-in grows out
 * of the trigger (prototype: x at the trigger's left, y at the edge nearest the trigger).
 */
function place(menu: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  // The viewport without scrollbars (`innerWidth` includes them).
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  if (!vw || !vh) return; // no layout (tests, detached): nothing to measure against
  menu.style.maxHeight = "";
  menu.style.overflowY = "";
  const w = menu.offsetWidth;
  let h = menu.offsetHeight;
  const roomBelow = vh - r.bottom - GAP - PAD;
  const roomAbove = r.top - GAP - PAD;
  // Flip when below overflows and above fits; when neither fits, take the roomier one.
  const below = h <= roomBelow || (h > roomAbove && roomBelow >= roomAbove);
  // Taller than the space available: cap the height and scroll.
  const cap = below ? roomBelow : roomAbove;
  if (h > cap) {
    menu.style.maxHeight = `${Math.max(cap, 0)}px`;
    menu.style.overflowY = "auto";
    h = menu.offsetHeight;
  }
  const left = clamp(r.left, PAD, vw - w - PAD);
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? r.bottom + GAP : r.top - GAP - h}px`;
  menu.style.setProperty("--menu-origin", `${clamp(r.left + 12 - left, 0, w)}px ${below ? "0" : "100%"}`);
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * Dropdown menu, hand-built to the prototype (no Radix: its menu inserts focus guards into the host body).
 * Arrow keys move (looping), Home/End, type-ahead, Enter/Space select, Esc and Tab close and return focus to
 * the trigger. It opens below the trigger (flipping above when there is no room), scales in from the trigger
 * (`--menu-origin`), and portals into the shadow root. Non-modal: no scroll lock, nothing touches the host
 * document. The outside `pointerdown` listener exists only while the menu is open.
 */
export function Menu({ trigger, items, header, selection, onSelect, onOpenChange, label }: MenuProps) {
  const container = useShadowContainer();
  const [isOpen, setIsOpen] = useState(false);
  // Mounted while open and for the exit animation after.
  const [present, setPresent] = useState(false);
  if (isOpen && !present) setPresent(true);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const typed = useRef({ text: "", timer: 0 });
  const menuId = useId();
  const autoTriggerId = useId();

  const triggerProps = trigger.props as {
    id?: string;
    ref?: Ref<HTMLElement>;
    disabled?: boolean;
    onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
  const triggerId = triggerProps.id ?? autoTriggerId;

  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      if (next !== isOpen) onOpenChange?.(next);
    },
    [isOpen, onOpenChange],
  );

  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (!returnFocus) return;
    const t = triggerRef.current;
    if (t?.isConnected) {
      t.focus({ preventScroll: true });
    } else if (container) {
      // The trigger is gone: park focus on the kit's container (so on the shadow host), not the page body.
      if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
      container.focus({ preventScroll: true });
    }
  };

  // Place and focus the first item once the content is in the DOM (same commit as `isOpen`).
  useLayoutEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    const anchor = triggerRef.current;
    if (!menu) return;
    if (anchor) place(menu, anchor);
    // Prototype: item 0 is focused however the menu was opened.
    (menuItems(menu)[0] ?? menu).focus({ preventScroll: true });
    setHighlighted(menuItems(menu)[0]?.dataset.key ?? null);
  }, [isOpen]);

  // While open: keep it anchored, and dismiss on a pointerdown outside the menu and the trigger.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const menu = menuRef.current;
      const anchor = triggerRef.current;
      if (menu && anchor) place(menu, anchor);
    };
    const outside = (ev: PointerEvent) => {
      const path = ev.composedPath();
      if ((menuRef.current && path.includes(menuRef.current)) || (triggerRef.current && path.includes(triggerRef.current)))
        return;
      setOpenRef.current(false);
    };
    // Scroll events do not cross the shadow boundary, so listen on the shadow root as well as the window.
    const menuEl = menuRef.current;
    const root = menuEl?.getRootNode();
    const onRootScroll = (ev: Event) => {
      if (menuEl && ev.target instanceof Node && menuEl.contains(ev.target)) return; // the menu's own scroll
      reposition();
    };
    const ro = menuEl && typeof ResizeObserver !== "undefined" ? new ResizeObserver(reposition) : null;
    if (menuEl) ro?.observe(menuEl);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    if (root && root !== document) root.addEventListener("scroll", onRootScroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (root && root !== document) root.removeEventListener("scroll", onRootScroll, true);
      ro?.disconnect();
    };
  }, [isOpen]);

  // Unmount after the exit animation (or at once when there is none, e.g. reduced motion or no CSS).
  useEffect(() => {
    if (isOpen || !present) return;
    const el = menuRef.current;
    const name = el ? getComputedStyle(el).animationName : "none";
    if (!el || !name || name === "none") {
      setPresent(false);
      return;
    }
    const done = () => setPresent(false);
    const onEnd = (e: AnimationEvent) => {
      if (e.target === el) done();
    };
    el.addEventListener("animationend", onEnd);
    const t = window.setTimeout(done, EXIT_FALLBACK_MS);
    return () => {
      el.removeEventListener("animationend", onEnd);
      window.clearTimeout(t);
    };
  }, [isOpen, present]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const choose = (item: MenuItem) => {
    onSelect(item.key);
    if (selection !== "multiple") close(true);
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = e.currentTarget;
    const { key } = e;
    if (key === "Escape") {
      e.preventDefault(); // handled: the shell's Esc ladder skips defaultPrevented keys
      e.stopPropagation();
      close(true);
      return;
    }
    if (key === "Tab") {
      // APG: close and focus the trigger, but let the default Tab run. The menu is portalled, so the browser
      // then moves focus to the element after (Shift+Tab: before) the trigger instead of trapping the user.
      e.stopPropagation();
      close(true);
      return;
    }
    const list = menuItems(menu);
    const active = (menu.getRootNode() as Document | ShadowRoot).activeElement;
    const i = list.findIndex((el) => el === active);
    const n = list.length;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      e.preventDefault();
      e.stopPropagation();
      if (n === 0) return;
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? n - 1
            : key === "ArrowDown"
              ? i < 0
                ? 0
                : (i + 1) % n
              : i < 0
                ? n - 1
                : (i - 1 + n) % n;
      list[next]?.focus({ preventScroll: true });
      return;
    }
    if (key === "Enter" || (key === " " && !typed.current.text)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // holding the key must not select again
      // The item the key was sent to wins over focus (a key event is addressed to its target).
      const targetItem = (e.target as Element | null)?.closest?.<HTMLElement>('[role^="menuitem"]');
      const k = targetItem?.dataset.key ?? (i >= 0 ? list[i]?.dataset.key : undefined);
      const item = items.find((it) => it.key === k);
      if (item) choose(item);
      return;
    }
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: a growing prefix, or the same letter repeated to cycle.
      if (key === " ") {
        // A space inside a type-ahead run (or one that finds nothing) must not scroll the host page.
        e.preventDefault();
        e.stopPropagation();
      }
      const t = typed.current;
      window.clearTimeout(t.timer);
      t.text += key.toLowerCase();
      t.timer = window.setTimeout(() => (t.text = ""), TYPEAHEAD_MS);
      const labelOf = (el: HTMLElement) => items.find((it) => it.key === el.dataset.key)?.label.toLowerCase() ?? "";
      const find = (): HTMLElement | undefined => {
        const cycle = t.text.split("").every((c) => c === t.text[0]);
        const needle = cycle ? t.text[0]! : t.text;
        const from = cycle ? i + 1 : Math.max(i, 0);
        for (let step = 0; step < n; step++) {
          const el = list[(from + step) % n];
          if (el && labelOf(el).startsWith(needle)) return el;
        }
        return undefined;
      };
      let hit = find();
      if (!hit && t.text.length > 1) {
        // The prefix went nowhere: start over with just this key.
        t.text = key.toLowerCase();
        hit = find();
      }
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        hit.focus({ preventScroll: true });
      }
    }
  };

  const renderItem = (item: MenuItem) => {
    return (
      <div
        key={item.key}
        className="mi"
        role={selection === "multiple" ? "menuitemcheckbox" : "menuitemradio"}
        tabIndex={-1}
        data-key={item.key}
        aria-checked={!!item.checked}
        data-highlighted={highlighted === item.key ? "" : undefined}
        onFocus={() => setHighlighted(item.key)}
        onPointerMove={(e) => {
          const root = e.currentTarget.getRootNode() as Document | ShadowRoot;
          if (root.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        }}
        onClick={() => choose(item)}
      >
        {item.icon}
        <span>{item.label}</span>
        {item.checked ? (
          <span className="ck">
            <Icon name="checkmark" size="s" />
          </span>
        ) : null}
      </div>
    );
  };

  const openFromTrigger = () => {
    if (!isOpen) setOpen(true);
  };

  const triggerEl = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    id: triggerId,
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      setRef(triggerProps.ref, node);
    },
    "aria-haspopup": "menu",
    "aria-expanded": isOpen,
    "aria-controls": present ? menuId : undefined,
    "data-state": isOpen ? "open" : "closed",
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      triggerProps.onPointerDown?.(e);
      if (e.defaultPrevented || triggerProps.disabled || e.button !== 0 || e.ctrlKey) return;
      if (isOpen) {
        setOpen(false);
      } else {
        e.preventDefault(); // keep focus where the menu puts it
        setOpen(true);
      }
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(e);
      if (e.defaultPrevented || triggerProps.disabled) return;
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        if (e.repeat) return; // a held key must not reopen what the menu just closed
        openFromTrigger();
      }
    },
  });

  const portalTarget = container ?? (typeof document === "undefined" ? null : document.body);

  return (
    <>
      {triggerEl}
      {present && portalTarget
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="menu"
              role="menu"
              tabIndex={-1}
              aria-orientation="vertical"
              aria-label={label}
              aria-labelledby={label ? undefined : triggerId}
              data-state={isOpen ? "open" : "closed"}
              onKeyDown={onMenuKeyDown}
            >
              {header ? <div className="mh" role="presentation">{header}</div> : null}
              {items.map(renderItem)}
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
