/**
 * The kit's UI, wired together: dock, pick engine, overlay, viewport stage, capture, composer slot, sheet and
 * ticket, command menu, toasts, shortcuts. This is the LAZY chunk: `proompter.tsx` imports it with `import()`
 * on first open, so nothing here (fonts included) is in the entry chunk.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createCapture } from "../../core/capture";
import type { Capture } from "../../core/capture/types";
import type { Entry } from "../../core/entry";
import { PickEngine, type PickCommit, type PickMode } from "../../core/pick";
import { findBySelector } from "../../core/resolve";
import type { PickSurface, ViewportId } from "../../core/surface";
import { buildCommandItems } from "../command/items";
import { Command } from "../command/command";
import { Dock, type DockTool } from "../dock/dock";
import { loadCollapsed, saveCollapsed } from "../dock/dock-storage";
import { DockedToaster, useDockPlacement } from "../dock/placement";
import { useFreeze, usePickSnapshot } from "../overlay/hooks";
import { Overlay } from "../overlay/overlay";
import type { PinModel } from "../overlay/pin-layout";
import type { PulseRequest } from "../overlay/pins";
import { toast } from "../primitives/toast";
import type { ProompterDeps, ProompterProps } from "../proompter-deps";
import { ShadowRoot, useShadowContainer } from "../shadow-root";
import { Sheet, type SheetTab, type SheetTicketProps } from "../sheet/sheet";
import { DEFAULT_TAGS } from "../ticket/labels";
import { ViewportStage } from "../viewports/viewport-stage";
import { createDefaultDeps } from "./defaults";
import type { DepsBox } from "./deps-box";
import { isToggleChord } from "./chord";
import { tailPath, viewportLabel } from "./format";
import { returnFocusFromFrame } from "./focus";
import { handleKeydown, type KeyActions, type KeyState } from "./shortcuts";
import { useRoute } from "./use-route";

export interface ShellProps {
  options: ProompterProps;
  box: DepsBox;
  /** `⌘⇧.` pressed inside a device frame (the entry chunk only sees keys on the host page). */
  onToggleKit(): void;
}

/** A "Show on page" request that has not completed after this long is dropped. */
const SHOW_GIVE_UP_MS = 8000;
const NO_PLUGINS: NonNullable<ProompterProps["plugins"]> = [];

interface SheetState {
  open: boolean;
  tab: SheetTab;
  selected: string | null;
}

export default function ProompterUI(props: ShellProps) {
  return (
    <ShadowRoot css={props.options.shadowCss}>
      <Kit {...props} />
    </ShadowRoot>
  );
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Kit({ options, box, onToggleKit }: ShellProps) {
  const container = useShadowContainer();
  const deps: ProompterDeps = useState(() => box.get(() => options.deps ?? createDefaultDeps(options)))[0];
  const { store, serialize, entryPath, composer } = deps;
  const { session, entries, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const reviewer = options.session?.reviewer ?? session.reviewer;
  const plugins = options.plugins ?? NO_PLUGINS;

  // -- state -------------------------------------------------------------------------------------------
  const [viewport, setViewport] = useState<ViewportId>("responsive");
  const [rotated, setRotated] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [surface, setSurface] = useState<PickSurface | null>(null);
  const [draft, setDraft] = useState<{ commit: PickCommit; key: number } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>({ open: false, tab: "entries", selected: null });
  const [pulse, setPulse] = useState<PulseRequest | null>(null);
  const [showReq, setShowReq] = useState<{ id: string; nonce: number } | null>(null);
  const [dockKey, setDockKey] = useState(0);
  const draftSeq = useRef(0);
  /** True while a keydown is being handled, so a tool shortcut starts keyboard picking on the page's `main`. */
  const byKey = useRef(false);
  const handleKey = (ev: KeyboardEvent) => {
    byKey.current = true;
    try {
      void handleKeydown(ev, keyState(), keyActions);
    } finally {
      byKey.current = false;
    }
  };
  const collapsed = useRef(loadCollapsed());

  const placement = useDockPlacement();
  const route = useRoute(surface);

  // The latest closures, for the engine, the document listener and timers (they outlive a render).
  const live = useRef<{
    onCommit(c: PickCommit): void;
    onModeChange(): void;
    onKey(ev: KeyboardEvent): void;
    onForwardedKey(ev: KeyboardEvent): void;
    surface: PickSurface | null;
    entries: readonly Entry[];
  }>({
    onCommit: () => {},
    onModeChange: () => {},
    onKey: () => {},
    onForwardedKey: () => {},
    surface: null,
    entries: [],
  });

  const [engine] = useState(
    () =>
      new PickEngine({
        // Esc is the root's (menu, composer, command menu, mode, ticket, sheet), not the engine's.
        escapeExits: false,
        onCommit: (c) => live.current.onCommit(c),
        onModeChange: () => live.current.onModeChange(),
        forwardKey: (ev) => live.current.onForwardedKey(ev),
      }),
  );
  const pick = usePickSnapshot(engine);
  const mode = pick.mode;

  useEffect(() => {
    engine.attach(surface);
    return () => engine.attach(null);
  }, [engine, surface]);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => engine.setBusy(draft !== null), [engine, draft]);
  // After a save or discard, focus may have been restored into the device frame: take it back.
  useEffect(() => {
    if (draft === null) returnFocusFromFrame();
  }, [draft]);
  useFreeze(surface, frozen);

  // -- capture -----------------------------------------------------------------------------------------
  // The host window's capture belongs to <Proompter> (it starts when the page is idle and stops when
  // <Proompter> unmounts); this reuses it, and only creates one if the UI opened before the idle task ran.
  const [hostCapture] = useState(
    () =>
      box.getCapture() ??
      box.setCapture(createCapture({ win: window, redact: options.redact, queries: options.queries })),
  );
  useEffect(() => {
    hostCapture.enable();
  }, [hostCapture]);
  // A device frame normally exposes its own capture (installed when the framed page loaded, so it saw the
  // page's start-up). If it did not, capture the frame from here on.
  const frameCaptures = useRef(new Map<Window, Capture>());
  useEffect(() => {
    if (surface?.kind !== "frame") return;
    const w = surface.win;
    if (w.__proompter_capture) return;
    const c = createCapture({ win: w, redact: options.redact, queries: options.queries });
    c.enable();
    const map = frameCaptures.current;
    map.set(w, c);
    return () => {
      c.disable();
      map.delete(w);
    };
  }, [surface, options.redact, options.queries]);
  const getCapture = (): Capture => {
    const s = live.current.surface;
    if (s?.kind === "frame") {
      const w = s.win;
      return w.__proompter_capture ?? frameCaptures.current.get(w) ?? hostCapture;
    }
    return hostCapture;
  };

  // -- actions -----------------------------------------------------------------------------------------
  const discardRef = useRef<{ discard(): void } | null>(null);
  const closeComposer = () => setDraft(null);
  // Esc: the composer closes itself with its exit animation when it can (it then calls `onClose`).
  const discardComposer = () => (discardRef.current ? discardRef.current.discard() : setDraft(null));
  const closeCommand = () => setCommandOpen(false);
  const openCommand = () => {
    setDraft(null);
    setCommandOpen(true);
  };
  const toggleCommand = () => (commandOpen ? closeCommand() : openCommand());

  const changeViewport = (v: ViewportId) => {
    setViewport(v);
    if (v === "responsive") setRotated(false);
  };
  const rotate = () => {
    if (viewport !== "responsive") setRotated(!rotated);
  };
  const toggleFreeze = () => {
    toast(frozen ? "Motion resumed" : "Motion frozen on the page");
    setFrozen(!frozen);
  };
  const toggleTool = (tool: Exclude<PickMode, "idle">) => {
    // A shortcut while the dock is collapsed expands it first (the prototype does).
    if (collapsed.current) {
      collapsed.current = false;
      saveCollapsed(false);
      setDockKey((k) => k + 1);
    }
    engine.toggleMode(tool, byKey.current);
  };

  const closeSheet = () => setSheet((s) => ({ ...s, open: false }));
  const toggleSheet = () => setSheet((s) => ({ ...s, open: !s.open }));
  const openTicket = (id: string) => {
    setCommandOpen(false);
    setSheet({ open: true, tab: "entries", selected: id });
  };

  const showOnPage = (entry: Entry) => {
    if (entry.viewport !== viewport) {
      changeViewport(entry.viewport);
      toast(`Switched to ${viewportLabel(entry.viewport).toLowerCase()}, where ${entry.id} was filed`);
    }
    if (entry.viewport !== "responsive") setRotated(entry.rotated);
    if (window.innerWidth < 900) closeSheet();
    setShowReq((r) => ({ id: entry.id, nonce: (r?.nonce ?? 0) + 1 }));
  };

  const pulseEntry = (entry: Entry) =>
    window.setTimeout(() => setPulse((p) => ({ id: entry.n, nonce: (p?.nonce ?? 0) + 1 })), 40);

  const onCreated = (entry: Entry) => {
    setDraft(null);
    engine.clearMulti();
    if (mode === "text") surface?.doc.getSelection()?.removeAllRanges();
    toast(
      <>
        <b style={{ fontWeight: 500 }}>{entry.id}</b> saved on {viewportLabel(entry.viewport).toLowerCase()} ·{" "}
        <span className="mono">{tailPath(entryPath(entry, session))}</span>
      </>,
    );
    pulseEntry(entry);
  };

  // "Show on page": the viewport switch comes first, then scroll to the element, then pulse its pin.
  useEffect(() => {
    if (!showReq) return;
    const entry = live.current.entries.find((e) => e.id === showReq.id);
    if (!entry) {
      setShowReq(null);
      return;
    }
    // If the switch never completes (the frame refuses to load), drop the request, so a later manual
    // viewport change does not scroll and pulse out of the blue.
    const timers: number[] = [window.setTimeout(() => setShowReq(null), SHOW_GIVE_UP_MS)];
    if (!surface || surface.viewport !== entry.viewport) return () => timers.forEach((t) => window.clearTimeout(t)); // still switching
    timers.push(
      window.setTimeout(() => {
        const sel = entry.target?.selector;
        const el = sel ? findBySelector(surface.doc, sel) : null;
        el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        timers.push(
          window.setTimeout(() => {
            surface.emitLayout();
            // Not in `timers`: clearing `showReq` re-runs this effect, and its cleanup must not cancel the pulse.
            pulseEntry(entry);
            setShowReq(null);
          }, 420),
        );
      }, 80),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [showReq, surface]);

  // -- keyboard ----------------------------------------------------------------------------------------
  const keyState = (): KeyState => ({
    menuOpen: !!container?.querySelector('[role="menu"]:not([data-state="closed"])'),
    // A composer that is saving or discarding is already `aria-hidden` and playing its 160ms exit; it no longer
    // owns the keyboard, so shortcuts pressed right after ⌘↵ or Esc are not lost.
    composerOpen: draft !== null && !container?.querySelector('.pm-comp[aria-hidden="true"]'),
    commandOpen,
    mode,
    sheetOpen: sheet.open,
    ticketOpen: sheet.selected !== null && sheet.tab === "entries",
  });
  const keyActions: KeyActions = {
    closeMenu: () => {
      // The menu closes itself on a real Esc (and marks it handled). This covers a key forwarded from a frame.
      const menu = container?.querySelector('[role="menu"]:not([data-state="closed"])');
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    },
    closeComposer: discardComposer,
    closeCommand,
    exitMode: () => engine.setMode("idle"),
    backToList: () => setSheet((s) => ({ ...s, selected: null })),
    closeSheet,
    toggleCommand,
    toggleTool,
    toggleFreeze,
    rotate,
    setViewport: changeViewport,
    toggleSheet,
  };

  useLayoutEffect(() => {
    live.current.surface = surface;
    live.current.entries = entries;
    live.current.onCommit = (commit) => {
      returnFocusFromFrame(); // a pick inside a device frame leaves focus there; keys must reach the host again
      setCommandOpen(false);
      setDraft({ commit, key: ++draftSeq.current });
    };
    live.current.onModeChange = () => setDraft(null);
    live.current.onKey = handleKey;
    live.current.onForwardedKey = (ev) => {
      if (isToggleChord(ev)) {
        ev.preventDefault();
        onToggleKit();
      } else {
        handleKey(ev);
      }
    };
  });

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => live.current.onKey(ev);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // -- derived -----------------------------------------------------------------------------------------
  const openCount = entries.filter((e) => e.status !== "resolved").length;
  const openOnSize = entries.filter((e) => e.viewport === viewport && e.status !== "resolved").length;
  const pins = useMemo<PinModel[]>(
    () =>
      entries.map((e) => ({
        id: e.n,
        ref: e.id,
        title: e.title,
        priority: e.priority,
        status: e.status,
        viewport: e.viewport,
        route: e.route,
        selector: e.target?.selector ?? null,
      })),
    [entries],
  );
  const planOptions = useMemo(() => Array.from(new Set(plugins.flatMap((p) => p.testPlan ?? []))), [plugins]);

  const commandItems = buildCommandItems({
    viewport,
    frozen,
    entries,
    pendingFiles: pending.length,
    onTool: (tool) => {
      setCommandOpen(false);
      toggleTool(tool);
    },
    onFreeze: () => {
      setCommandOpen(false);
      toggleFreeze();
    },
    onViewport: (v) => {
      setCommandOpen(false);
      changeViewport(v);
    },
    onOpenEntry: openTicket,
    onAllEntries: () => {
      setCommandOpen(false);
      setSheet({ open: true, tab: "entries", selected: null });
    },
    onPublish: () => {
      setCommandOpen(false);
      setSheet({ open: true, tab: "publish", selected: null });
    },
  });

  const write = store.write;
  const issue = store.openIssue;
  const ticket: SheetTicketProps = {
    serialize: (e) => serialize(e, session),
    entryPath: (e) => entryPath(e, session),
    tagOptions: DEFAULT_TAGS,
    planOptions,
    canOpenIssue: !!issue,
    onShow: showOnPage,
    onUpdate: (e, patch) => store.update(e.id, patch, reviewer),
    onResolve: (e) => store.resolve(e.id, reviewer),
    onOpenIssue: issue ? (e) => issue.call(store, e.id, reviewer) : undefined,
  };

  const activeTool: DockTool | null = mode === "idle" ? null : mode === "box" ? "area" : mode;
  const dockEdge = placement.mode === "vertical-left" ? "l" : placement.mode === "vertical-right" ? "r" : null;

  return (
    <>
      <ViewportStage
        viewport={viewport}
        rotated={rotated}
        dockVertical={placement.mode !== "horizontal"}
        openOnSize={openOnSize}
        url={options.frameSrc}
        onSurface={setSurface}
        onExit={() => changeViewport("responsive")}
      />
      <Overlay
        surface={surface}
        engine={engine}
        viewport={viewport}
        pins={pins}
        route={route}
        pulse={pulse}
        onOpenPin={(id) => {
          const e = entries.find((x) => x.n === id);
          if (e) openTicket(e.id);
        }}
        dock={{ rect: placement.rect, edge: dockEdge }}
      />
      <Dock
        key={dockKey}
        activeTool={activeTool}
        frozen={frozen}
        viewport={viewport}
        rotated={rotated}
        commandOpen={commandOpen}
        entriesOpen={sheet.open}
        openCount={openCount}
        onTool={(t) => toggleTool(t === "area" ? "box" : t)}
        onFreeze={toggleFreeze}
        onViewport={changeViewport}
        onRotate={rotate}
        onCommand={toggleCommand}
        onEntries={toggleSheet}
        onCollapsedChange={(c) => {
          collapsed.current = c;
          if (c) engine.setMode("idle");
        }}
      />
      {draft ? (
        <Fragment key={draft.key}>
          {composer({
            commit: draft.commit,
            surface,
            viewport,
            rotated,
            session,
            plugins,
            getCapture,
            onClose: closeComposer,
            discardRef,
            onCreated,
          })}
        </Fragment>
      ) : null}
      <Sheet
        open={sheet.open}
        side={placement.sheetSide}
        session={session}
        entries={entries}
        pending={pending}
        tab={sheet.tab}
        onTabChange={(tab) => setSheet((s) => ({ ...s, tab }))}
        selectedId={sheet.selected}
        onSelect={(id) => setSheet((s) => ({ ...s, selected: id }))}
        onClose={closeSheet}
        onWrite={write ? () => write.call(store) : undefined}
        ticket={ticket}
      />
      <Command
        open={commandOpen}
        onOpenChange={(o) => (o ? openCommand() : closeCommand())}
        items={commandItems}
        animated={options.shadowCss !== ""}
      />
      <DockedToaster />
    </>
  );
}
