import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "../icons";
import { cx } from "./cx";

/** Visible time before a toast starts leaving, and the length of its exit animation. */
const DURATION_MS = 2800;
const EXIT_MS = 200;
const MAX_TOASTS = 3;

export interface ToastOptions {
  /** Leading icon. Defaults to the green check. */
  icon?: ReactNode;
}

interface ToastData {
  /** Unique per `toast()` call: keys and timers use it. */
  id: number;
  message: ReactNode;
  icon: ReactNode;
  leaving: boolean;
}

interface ToastState {
  items: ToastData[];
  /** Hovering (or focusing) any toast pauses every timer. */
  paused: boolean;
}

// Module-level store, Sonner-style: call `toast()` from anywhere, render one `<Toaster />`.
let state: ToastState = { items: [], paused: false };
let seq = 0;
const listeners = new Set<() => void>();

function set(next: Partial<ToastState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => state;

/** Mark toasts as leaving (exit animation), then remove them. */
function leave(ids: number[]) {
  const targets = state.items.filter((t) => ids.includes(t.id) && !t.leaving).map((t) => t.id);
  if (targets.length === 0) return;
  set({ items: state.items.map((t) => (targets.includes(t.id) ? { ...t, leaving: true } : t)) });
  setTimeout(() => set({ items: state.items.filter((t) => !targets.includes(t.id)) }), EXIT_MS);
}

/**
 * Show a toast. At most `MAX_TOASTS` (3) stay visible: a 4th pushes the oldest out, which leaves with
 * the exit animation.
 */
export function toast(message: ReactNode, options: ToastOptions = {}): void {
  const item: ToastData = {
    id: ++seq,
    message,
    icon: options.icon === undefined ? <Icon name="check" /> : options.icon,
    leaving: false,
  };
  const items = [...state.items, item];
  set({ items });
  const live = items.filter((t) => !t.leaving);
  leave(live.slice(0, Math.max(0, live.length - MAX_TOASTS)).map((t) => t.id));
}

/** Remove everything immediately. For tests and teardown. */
toast.clear = () => set({ items: [], paused: false });

function ToastItem({ data, paused }: { data: ToastData; paused: boolean }) {
  const { id, leaving } = data;
  const remaining = useRef(DURATION_MS);
  const startedAt = useRef(0);

  // One timer per toast. While paused it's cleared and the elapsed time is banked, so a paused toast
  // resumes with the time it had left (Sonner's behaviour).
  useEffect(() => {
    if (paused || leaving) return;
    startedAt.current = Date.now();
    const t = setTimeout(() => leave([id]), Math.max(0, remaining.current));
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, leaving, id]);

  return (
    <div className={cx("toast", leaving && "out")}>
      {data.icon}
      <span>{data.message}</span>
    </div>
  );
}

export interface ToasterProps {
  /** `top` when the dock sits at the bottom of the screen and the toasts would collide with it. */
  position?: "bottom" | "top";
}

/** Renders the live toasts. Mount once, inside the shadow root. */
export function Toaster({ position = "bottom" }: ToasterProps) {
  const { items, paused } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // If the toast under the cursor is removed, no pointerout ever fires. Re-derive `paused` whenever the
  // list changes: reset when it empties, otherwise ask the browser whether anything is still hovered.
  useEffect(() => {
    if (!pausedRef.current) return;
    if (items.length === 0) {
      set({ paused: false });
      return;
    }
    const t = setTimeout(() => {
      let hovered = false;
      try {
        hovered = !!ref.current?.matches(":hover");
      } catch {
        // `:hover` unsupported: assume not hovered.
      }
      if (!hovered && pausedRef.current) set({ paused: false });
    }, 100);
    return () => clearTimeout(t);
  }, [items]);

  return (
    <div
      ref={ref}
      className={cx("toasts", position === "top" && "top")}
      role="status"
      aria-live="polite"
      onPointerOver={(e) => {
        if ((e.target as Element).closest(".toast")) set({ paused: true });
      }}
      onPointerOut={(e) => {
        const to = e.relatedTarget as Element | null;
        if (!to || !to.closest?.(".toast")) set({ paused: false });
      }}
      onFocus={() => set({ paused: true })}
      onBlur={() => set({ paused: false })}
    >
      {items.map((t) => (
        <ToastItem key={t.id} data={t} paused={paused} />
      ))}
    </div>
  );
}
