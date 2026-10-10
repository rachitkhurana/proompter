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
import { CheckMarkIcon } from "../icons";
import { useShadowContainer } from "../shadow-root";

export interface MenuItem {
  /** Stable id, passed to `onSelect`. */
  key: string;
  label: string;
  icon?: ReactNode;
  /** Right-aligned hint, usually a `<Kbd>`. Not shown for checked items (they show the check). */
  shortcut?: ReactNode;
  /** Selected state, for `selection="single"` and `"multiple"`. */
  checked?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  /** The element that opens the menu (a button or `<Chip as="button">`). It must forward its ref. */
  trigger: ReactElement;
  items: ReadonlyArray<MenuItem>;
  /** Small heading above the items. */
  header?: ReactNode;
  /**
   * `none`: plain actions, the menu closes on select.
   * `single`: one checked item (radio), the menu closes on select.
   * `multiple`: any number checked (tags), the menu stays open on select.
   */
  selection?: "none" | "single" | "multiple";
  onSelect: (key: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Accessible name of the menu. Falls back to the trigger's. */
  label?: string;
}

type Side = NonNullable<MenuProps["side"]>;
type Align = NonNullable<MenuProps["align"]>;

const GAP = 6; // trigger to menu (prototype)
const PAD = 8; // viewport edge (prototype)
const EXIT_FALLBACK_MS = 250;
const TYPEAHEAD_MS = 500;
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])'));
}

/**
 * Position `menu` (fixed) next to `anchor`: on `side`, flipped to the opposite side when it would overflow the
 * viewport and the opposite fits, clamped to the viewport edge. Sets `--menu-origin` so the scale-in grows out
 * of the trigger (prototype: x at the trigger's aligned point, y at the edge nearest the trigger).
 */
function place(menu: HTMLElement, anchor: HTMLElement, side: Side, align: Align) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits: Record<Side, boolean> = {
    bottom: r.bottom + GAP + h <= vh - PAD,
    top: r.top - GAP - h >= PAD,
    right: r.right + GAP + w <= vw - PAD,
    left: r.left - GAP - w >= PAD,
  };
  const s = !fits[side] && fits[OPPOSITE[side]] ? OPPOSITE[side] : side;
  let left: number;
  let top: number;
  let ox: number | string;
  let oy: number | string;
  if (s === "top" || s === "bottom") {
    top = s === "bottom" ? r.bottom + GAP : r.top - GAP - h;
    const wanted = align === "start" ? r.left : align === "center" ? r.left + (r.width - w) / 2 : r.right - w;
    left = clamp(wanted, PAD, vw - w - PAD);
    const ref = align === "start" ? r.left + 12 : align === "center" ? r.left + r.width / 2 : r.right - 12;
    ox = clamp(ref - left, 0, w);
    oy = s === "bottom" ? "0" : "100%";
  } else {
    left = s === "right" ? r.right + GAP : r.left - GAP - w;
    const wanted = align === "start" ? r.top : align === "center" ? r.top + (r.height - h) / 2 : r.bottom - h;
    top = clamp(wanted, PAD, vh - h - PAD);
    const ref = align === "start" ? r.top + 12 : align === "center" ? r.top + r.height / 2 : r.bottom - 12;
    ox = s === "right" ? "0" : "100%";
    oy = clamp(ref - top, 0, h);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.setProperty("--menu-origin", `${typeof ox === "number" ? `${ox}px` : ox} ${typeof oy === "number" ? `${oy}px` : oy}`);
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * Dropdown menu, hand-built to the prototype (no Radix: its menu inserts focus guards into the host body).
 * Arrow keys move (looping), Home/End, type-ahead, Enter/Space select, Esc and Tab close and return focus to
 * the trigger. It is positioned on `side` with a flip, scales in from the trigger (`--menu-origin`), and
 * portals into the shadow root. Non-modal: no scroll lock, nothing touches the host document. The outside
 * `pointerdown` listener exists only while the menu is open.
 */
export function Menu({
  trigger,
  items,
  header,
  selection = "none",
  onSelect,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
  label,
}: MenuProps) {
  const container = useShadowContainer();
  const [openState, setOpenState] = useState(!!defaultOpen);
  const isOpen = open ?? openState;
  // Mounted while open and for the exit animation after.
  const [present, setPresent] = useState(isOpen);
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
      if (open === undefined) setOpenState(next);
      if (next !== isOpen) onOpenChange?.(next);
    },
    [open, isOpen, onOpenChange],
  );

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  // Place and focus the first item once the content is in the DOM (same commit as `isOpen`).
  useLayoutEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    const anchor = triggerRef.current;
    if (!menu) return;
    if (anchor) place(menu, anchor, side, align);
    // Prototype: item 0 is focused however the menu was opened.
    (enabledItems(menu)[0] ?? menu).focus({ preventScroll: true });
    setHighlighted(enabledItems(menu)[0]?.dataset.key ?? null);
  }, [isOpen, side, align]);

  // While open: keep it anchored, and dismiss on a pointerdown outside the menu and the trigger.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const menu = menuRef.current;
      const anchor = triggerRef.current;
      if (menu && anchor) place(menu, anchor, side, align);
    };
    const outside = (ev: PointerEvent) => {
      const path = ev.composedPath();
      if ((menuRef.current && path.includes(menuRef.current)) || (triggerRef.current && path.includes(triggerRef.current)))
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen, side, align, setOpen]);

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
    if (item.disabled) return;
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
      e.preventDefault();
      close(true);
      return;
    }
    const list = enabledItems(menu);
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
      // The item the key was sent to wins over focus (a key event is addressed to its target).
      const targetItem = (e.target as Element | null)?.closest?.<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
      const k = targetItem?.dataset.key ?? (i >= 0 ? list[i]?.dataset.key : undefined);
      const item = items.find((it) => it.key === k);
      if (item) choose(item);
      return;
    }
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: a growing prefix, or the same letter repeated to cycle.
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
    const role = selection === "multiple" ? "menuitemcheckbox" : selection === "single" ? "menuitemradio" : "menuitem";
    return (
      <div
        key={item.key}
        className="mi"
        role={role}
        tabIndex={-1}
        data-key={item.key}
        aria-checked={selection === "none" ? undefined : !!item.checked}
        aria-disabled={item.disabled || undefined}
        data-disabled={item.disabled ? "" : undefined}
        data-highlighted={highlighted === item.key ? "" : undefined}
        onFocus={() => setHighlighted(item.key)}
        onPointerMove={(e) => {
          if (item.disabled) return;
          const root = e.currentTarget.getRootNode() as Document | ShadowRoot;
          if (root.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        }}
        onClick={() => choose(item)}
      >
        {item.icon}
        <span>{item.label}</span>
        {selection === "none" ? (
          item.shortcut
        ) : item.checked ? (
          <span className="ck">
            <CheckMarkIcon size="s" />
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
              {header ? <div className="mh">{header}</div> : null}
              {items.map(renderItem)}
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
