import { useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type { Capture, CaptureContext, Surface as CaptureSurface } from "../../core/capture";
import type { Entry, EntryIntent, EntryPriority, EntrySnapshot, EntryTarget, ProompterPlugin } from "../../core/entry";
import type { PickCommit } from "../../core/pick";
import { pluginContext, pluginTask, pluginTestPlan } from "../../core/plugins";
import { shortSource, type ResolvedTarget } from "../../core/resolve";
import { cleanDescription, entryPath } from "../../core/serialize";
import { RedactError, type EntryStore, type NewEntry } from "../../core/store";
import { VIEWPORTS, type PickSurface, type ViewportId } from "../../core/surface";
import { getDockPlacement } from "../dock/placement";
import { ChevIcon, CodeIcon, FileIcon, Icon, LayersIcon, PlanIcon, TagIcon, XIcon } from "../icons";
import { Button, IconButton } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { cx } from "../primitives/cx";
import { Kbd } from "../primitives/kbd";
import { Menu, type MenuItem } from "../primitives/menu";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { toast } from "../primitives/toast";
import { composerCss } from "./composer-styles";
import {
  DEFAULT_TAGS,
  INTENT_LABEL,
  INTENT_ORDER,
  KIND_ICON,
  NO_PLAN_KEY,
  PRIORITY_ORDER,
  plural,
  targetName,
} from "./labels";
import { placeComposer, unionBox, type Box } from "./place";

export type ComposerResult = { type: "saved"; entry: Entry } | { type: "discarded" };

/** Imperative handle (`ref`): lets a root that owns the Esc order close the composer. */
export interface ComposerHandle {
  /** Discard like Esc would (ignored while saving or already closing). */
  discard(): void;
}

export interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  /** Listen for Esc and discard (default true). A root that owns the global Esc order passes false and calls `ref.discard()`. */
  handleEscape?: boolean;
  /** Show the "saved" toast (default true). A root that toasts itself from `onClose` passes false. */
  toast?: boolean;
  /** What the pick engine committed (`PickEngine`'s `onCommit`). */
  commit: PickCommit;
  /** The surface the target lives in: projects element rects to screen space, and is what gets snapshotted. */
  surface: PickSurface;
  viewport: ViewportId;
  /** Exact surface size when filed (`surface.size()`). */
  size: { width: number; height: number };
  rotated: boolean;
  /** The page route the review is on, e.g. `/feeds`. */
  route: string;
  capture: Capture;
  store: EntryStore;
  /** Host plugins: task chip, test plan menu, extra frontmatter, redaction. */
  plugins?: readonly ProompterPlugin[];
  /** `branch@sha` for the `Build:` line. Defaults to the store session's. */
  build?: string;
  /** Tag choices in the Tags menu. Defaults to the prototype's seven. */
  tags?: readonly string[];
  /** Exit animation length, ms (0 when the user prefers reduced motion). Default 160. */
  exitMs?: number;
  /**
   * Called once, after the exit animation: `saved` with the stored entry (the root should pulse its pin and
   * leave pick mode), or `discarded` (Esc, click outside, the X, Cancel).
   */
  onClose(result: ComposerResult): void;
}

const toEntryTarget = (t: ResolvedTarget): EntryTarget => ({
  selector: t.selector,
  source: t.source,
  sourceInherited: t.inherited,
  label: t.label,
  component: t.crumb,
});

function commitTargets(commit: PickCommit): ResolvedTarget[] {
  switch (commit.kind) {
    case "element":
      return [commit.target];
    case "multi":
    case "box":
      return commit.targets;
    case "text":
      return commit.target ? [commit.target] : [];
    default:
      return [];
  }
}

/** The target on screen. Elements are measured in their own document and projected by the surface. */
function anchorOf(commit: PickCommit, surface: PickSurface, targets: readonly ResolvedTarget[]): Box | null {
  if (commit.kind === "box" || commit.kind === "text") return commit.rect;
  if (commit.kind === "note") return null;
  return unionBox(
    targets.map((t) => {
      const r = t.el.getBoundingClientRect();
      return surface.toScreen({ left: r.left, top: r.top, width: r.width, height: r.height });
    }),
  );
}

/** Capture must never stop an entry from being filed: a throwing `context()` means "no context". */
function safeContext(capture: Capture): CaptureContext {
  try {
    return capture.context();
  } catch {
    return { console: [], network: [], queries: [], internalErrors: [] };
  }
}

const isMac = () => {
  try {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  } catch {
    return false;
  }
};

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

const reducedMotion = () => {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * The composer (DESIGN §7): anchored to the target and growing out of it, clear of the dock. Title is required;
 * ⌘↵ / Ctrl↵ files the entry; Esc, a click outside, Cancel or the X discards it. Renders its own CSS, and must be
 * inside the shadow root (it uses the menu primitive's portal container). Mount `<Toaster>` for the "saved" toast.
 *
 * On save it reads the capture context, takes the snapshot, builds the entry, and hands it to `store.create`
 * (which numbers it, runs the plugins' `redact`, persists it and emits `entry:created`). If a redact plugin fails
 * nothing is stored: the composer stays open with the reason, and the user's text is kept.
 */
export function Composer({
  ref,
  handleEscape = true,
  toast: showToast = true,
  commit,
  surface,
  viewport,
  size,
  rotated,
  route,
  capture,
  store,
  plugins,
  build,
  tags: tagChoices = DEFAULT_TAGS,
  exitMs = 160,
  onClose,
}: ComposerProps) {
  const resolved = useMemo(() => commitTargets(commit), [commit]);
  const entryTargets = useMemo(() => resolved.map(toEntryTarget), [resolved]);
  const primary = entryTargets[0];
  const quote = commit.kind === "text" ? commit.quote : undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState<EntryIntent>("fix");
  const [priority, setPriority] = useState<EntryPriority>("important");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [plan, setPlan] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const task = useMemo(() => pluginTask(plugins, { source: primary?.source ?? undefined, route }), [plugins, primary, route]);
  const planSections = useMemo(() => pluginTestPlan(plugins), [plugins]);
  /** What the "Context attached" block shows: the buffers as they were when the composer opened. */
  const preview = useMemo(() => safeContext(capture), [capture]);
  const failed = preview.network.filter((n) => !n.ok).length;

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const closingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openMenus = useRef(new Set<string>());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ---- position
  const [pos, setPos] = useState({ left: 0, top: 0, ox: "50%", oy: "0" });
  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos(
      placeComposer({
        anchor: anchorOf(commit, surface, resolved),
        panel: { width: el.offsetWidth || Math.min(500, vw - 24), height: el.offsetHeight },
        viewport: { width: vw, height: vh },
        dock: getDockPlacement().rect,
      }),
    );
  }, [commit, surface, resolved]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    window.addEventListener("resize", place);
    // The panel grows (context expanded, a long quote, an error line): keep it on screen and clear of the dock.
    const el = rootRef.current;
    const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place()) : null;
    if (el) ro?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [place]);

  // ---- closing
  const finish = useCallback(
    (result: ComposerResult) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setLeaving(true);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => onCloseRef.current(result), reducedMotion() ? 0 : exitMs);
    },
    [exitMs],
  );
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const discard = useCallback(() => {
    if (savingRef.current) return;
    finish({ type: "discarded" });
  }, [finish]);
  const discardRef = useRef(discard);
  discardRef.current = discard;
  const escapeRef = useRef(handleEscape);
  escapeRef.current = handleEscape;
  useImperativeHandle(ref, () => ({ discard: () => discardRef.current() }), []);

  // Focus the title shortly after opening (prototype: 30ms).
  useEffect(() => {
    const t = setTimeout(() => {
      // Don't steal focus from something inside the composer the user already reached (a chip, a menu).
      const root = rootRef.current;
      const active = (root?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
      if (root && active && root.contains(active)) return;
      titleRef.current?.focus({ preventScroll: true });
    }, 30);
    return () => clearTimeout(t);
  }, []);

  // Esc discards, unless a menu took it first (Radix closes the menu and marks the event handled).
  // Clicking outside discards, unless it landed in a menu or a toast. The listener is added a tick late so the
  // press that opened the composer can't close it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!escapeRef.current || e.key !== "Escape" || e.defaultPrevented || openMenus.current.size > 0) return;
      e.preventDefault();
      discardRef.current();
    };
    const onDown = (e: Event) => {
      if (openMenus.current.size > 0) return;
      const path = e.composedPath();
      if (rootRef.current && path.includes(rootRef.current)) return;
      if (path.some((n) => n instanceof Element && (n.classList.contains("menu") || n.classList.contains("toast")))) return;
      discardRef.current();
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  // ---- save
  const save = async () => {
    if (savingRef.current || closingRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setShowError(true);
      titleRef.current?.focus({ preventScroll: true });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const ctx = safeContext(capture);
      let snapshot: EntrySnapshot | undefined;
      try {
        // Capture's own `Surface` wants `win: Window & typeof globalThis`; the pick surface's is `Window`.
        const shot = await capture.snapshot(surface as unknown as CaptureSurface, resolved[0]?.el);
        if (shot.element || shot.viewport) {
          snapshot = { fontsEmbedded: shot.fontsEmbedded, ...(shot.element ? { element: shot.element } : {}), ...(shot.viewport ? { viewport: shot.viewport } : {}) };
        }
      } catch {
        // An entry without a picture is better than no entry.
      }
      const session = store.getState().session;
      const buildLine = build ?? (session.branch ? (session.sha ? `${session.branch}@${session.sha}` : session.branch) : undefined);
      const extra = pluginContext(plugins);
      const draft: NewEntry = {
        kind: commit.kind,
        title: trimmed,
        description: cleanDescription(description),
        intent,
        priority,
        viewport,
        size,
        rotated,
        route,
        ...(primary ? { target: primary } : {}),
        targets: entryTargets,
        ...(quote !== undefined ? { quote } : {}),
        ...(task ? { task } : {}),
        ...(plan ? { testPlan: plan } : {}),
        tags: [...selectedTags],
        context: {
          console: ctx.console,
          network: ctx.network,
          queries: ctx.queries,
          ...(buildLine ? { build: buildLine } : {}),
        },
        ...(snapshot ? { snapshot } : {}),
        ...(extra ? { extra } : {}),
      };
      const entry = await store.create(draft, { plugins });
      if (showToast) toast(
        <>
          <b style={{ fontWeight: 500 }}>{entry.id}</b> saved on {VIEWPORTS[entry.viewport].label.toLowerCase()} ·{" "}
          <span className="mono">{entryPath(entry)}</span>
        </>,
      );
      savingRef.current = false;
      finish({ type: "saved", entry });
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      setSaveError(
        e instanceof RedactError
          ? `Plugin ${e.plugin} failed to redact this entry. Nothing was saved.`
          : "Not saved: something went wrong. Your text is still here.",
      );
      toast("Couldn’t save this entry", { icon: <XIcon /> });
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  const onRootKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveRef.current();
    }
  };

  const copySource = async () => {
    if (!primary?.source) return;
    try {
      await navigator.clipboard.writeText(primary.source);
      toast(`Copied ${shortSource(primary.source)}`);
    } catch {
      toast("Couldn’t copy to the clipboard", { icon: <XIcon /> });
    }
  };

  // ---- menus
  const track = (name: string) => (open: boolean) => {
    if (open) openMenus.current.add(name);
    else openMenus.current.delete(name);
  };

  const intentItems: MenuItem[] = INTENT_ORDER.map((k) => ({
    key: k,
    label: INTENT_LABEL[k],
    icon: <Icon name={k} size="s" />,
    checked: intent === k,
  }));
  const priorityItems: MenuItem[] = PRIORITY_ORDER.map((k) => ({
    key: k,
    label: PRIORITY_LABEL[k],
    icon: <PriorityIcon priority={k} />,
    checked: priority === k,
  }));
  const tagItems: MenuItem[] = tagChoices.map((t) => ({
    key: t,
    label: t,
    icon: <TagIcon size="s" />,
    checked: selectedTags.includes(t),
  }));
  const planItems: MenuItem[] = [
    { key: NO_PLAN_KEY, label: "Not linked", checked: plan === null },
    ...planSections.map((p) => ({ key: p, label: p, icon: <PlanIcon size="s" />, checked: plan === p })),
  ];

  const name = targetName(commit.kind, resolved.length, primary?.label ?? "");
  const fileText = !primary ? "page-level" : (primary.source ?? "no source (nothing is stamped here)");
  const errId = "pm-title-error";

  return (
    <>
      <style data-proompter-composer="">{composerCss}</style>
      <div
        ref={rootRef}
        className={cx("pm-comp", !leaving && "on")}
        role="dialog"
        aria-label="New entry"
        aria-hidden={leaving || undefined}
        style={{ left: pos.left, top: pos.top, transformOrigin: `${pos.ox} ${pos.oy}` }}
        onKeyDown={onRootKeyDown}
      >
        <div className="pm-comp-hd">
          <div className="pm-target">
            <span className="pm-ti">
              <Icon name={KIND_ICON[commit.kind]} size="s" />
            </span>
            <span className="pm-nm">{name}</span>
            {primary?.source ? (
              <Chip
                as="button"
                mono
                onClick={() => void copySource()}
                title={`${primary.sourceInherited ? "Nearest component source. " : ""}Copy file and line`}
                aria-label={`Copy ${primary.source}`}
              >
                {primary.sourceInherited ? "↳ " : ""}
                {shortSource(primary.source)}
              </Chip>
            ) : null}
          </div>
          <Chip ghost className="num" icon={<Icon name={viewport} size="s" />}>
            {`${size.width}×${size.height}`}
          </Chip>
          <IconButton label="Discard" onClick={discard}>
            <XIcon size="s" />
          </IconButton>
        </div>

        <div className="pm-comp-bd">
          {quote !== undefined ? <div className="pm-quote">“{quote}”</div> : null}
          <input
            ref={titleRef}
            className="pm-in-title"
            placeholder="Title"
            aria-label="Title"
            autoComplete="off"
            value={title}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? errId : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setShowError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                descRef.current?.focus({ preventScroll: true });
              }
            }}
          />
          <textarea
            ref={descRef}
            className="pm-in-desc"
            placeholder="What’s wrong, and what should happen instead?"
            aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="pm-err" id={errId} hidden={!showError} role={showError ? "alert" : undefined}>
            Add a title. It becomes the file name and the GitHub issue title.
          </div>
          {saveError ? (
            <div className="pm-err" role="alert">
              {saveError}
            </div>
          ) : null}
        </div>

        <div className="pm-props">
          <Menu
            label="Intent"
            selection="single"
            items={intentItems}
            onSelect={(k) => setIntent(k as EntryIntent)}
            onOpenChange={track("intent")}
            trigger={
              <Chip as="button" icon={<Icon name={intent} size="s" />}>
                {INTENT_LABEL[intent]}
              </Chip>
            }
          />
          <Menu
            label="Priority"
            selection="single"
            items={priorityItems}
            onSelect={(k) => setPriority(k as EntryPriority)}
            onOpenChange={track("priority")}
            trigger={
              <Chip as="button" icon={<PriorityIcon priority={priority} />}>
                {PRIORITY_LABEL[priority]}
              </Chip>
            }
          />
          <Menu
            label="Tags"
            header="Tags"
            selection="multiple"
            items={tagItems}
            onSelect={(k) => setSelectedTags((cur) => (cur.includes(k) ? cur.filter((t) => t !== k) : [...cur, k]))}
            onOpenChange={track("tags")}
            trigger={
              <Chip as="button" icon={<TagIcon size="s" />}>
                {selectedTags.length ? selectedTags.join(", ") : "Tags"}
              </Chip>
            }
          />
          {planSections.length > 0 ? (
            <Menu
              label="Test plan"
              header="Link to the manual test plan"
              selection="single"
              items={planItems}
              onSelect={(k) => setPlan(k === NO_PLAN_KEY ? null : k)}
              onOpenChange={track("plan")}
              trigger={
                <Chip as="button" icon={<PlanIcon size="s" />}>
                  {plan ?? "Test plan"}
                </Chip>
              }
            />
          ) : null}
          {task ? (
            <Chip accent icon={<CodeIcon size="s" />} title="Task, from the host's plugin">
              {task}
            </Chip>
          ) : null}
        </div>

        <details className="pm-ctx">
          <summary>
            <LayersIcon size="s" />
            <span>
              Context attached: {plural(preview.console.length, "console line", "console lines")},{" "}
              {plural(preview.network.length, "request", "requests")}, <span className="pm-bad">{failed} failed</span>
            </span>
            <span className="pm-car">
              <ChevIcon size="s" />
            </span>
          </summary>
          <div className="pm-ctx-in">
            <div>
              <div className="pm-lbl">Source</div>
              <div className="pm-log">
                <div>
                  <span className="m">file</span>
                  <span />
                  <span>
                    {fileText}
                    {primary?.source && primary.sourceInherited ? " (nearest component)" : ""}
                  </span>
                </div>
                <div>
                  <span className="m">tree</span>
                  <span />
                  <span>{primary?.component || route}</span>
                </div>
                {resolved[0]?.query ? (
                  <div>
                    <span className="m">query</span>
                    <span />
                    <span>{resolved[0].query}</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <div className="pm-lbl">Console</div>
              <div className="pm-log">
                {preview.console.length === 0 ? (
                  <div>
                    <span className="m">none</span>
                  </div>
                ) : (
                  preview.console.map((c, i) => (
                    <div key={i}>
                      <span className="m">{clock(c.timestamp)}</span>
                      <span className={c.level === "error" ? "e" : "w"}>{c.level}</span>
                      <span>{c.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="pm-lbl">Network</div>
              <div className="pm-log">
                {preview.network.length === 0 ? (
                  <div>
                    <span className="m">none</span>
                  </div>
                ) : (
                  preview.network.map((n, i) => (
                    <div key={i}>
                      <span className={n.ok ? "g" : "e"}>{n.status ?? "ERR"}</span>
                      <span className="m num">{Math.round(n.durationMs)}ms</span>
                      <span>
                        {n.method} {n.url}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </details>

        <div className="pm-comp-ft">
          <span className="pm-hint">
            <FileIcon size="xs" />
            <span className="mono">reviews/…/entries</span>
          </span>
          <Button variant="ghost" onClick={discard}>
            Cancel
          </Button>
          <Button variant="pri" disabled={saving} onClick={() => void save()}>
            Create entry <Kbd>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd>
          </Button>
        </div>
      </div>
    </>
  );
}
