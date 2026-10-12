import { useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type { Capture, CaptureContext } from "../../core/capture/types";
import type { Entry, EntryIntent, EntryPriority, EntrySnapshot, EntryTarget, ProompterPlugin } from "../../core/entry";
import type { PickCommit } from "../../core/pick";
import { pluginContext, pluginTask, pluginTestPlan } from "../../core/plugins";
import { shortSource, type ResolvedTarget } from "../../core/resolve";
import { cleanDescription } from "../../core/serialize";
import { RedactError, type EntryStore, type NewEntry } from "../../core/store";
import type { PickSurface, ViewportId } from "../../core/surface";
import { getDockPlacement } from "../dock/placement";
import { Icon } from "../icons";
import { Button, IconButton } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { cx } from "../primitives/cx";
import { Kbd } from "../primitives/kbd";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { toast } from "../primitives/toast";
import { reducedMotion } from "../../core/motion";
import { LogRows, PropMenu, propertyItems } from "../entry-parts";
import { DEFAULT_TAGS, INTENT_LABEL, KIND_ICON, NO_PLAN_KEY, plural, targetName } from "../labels";
import { useShadowContainer } from "../shadow-root";
import { copyText } from "../shell/clipboard";
import { placeComposer, unionBox, type Box } from "./place";

export type ComposerResult = { type: "saved"; entry: Entry } | { type: "discarded" };

/** Imperative handle (`ref`): lets a root that owns the Esc order close the composer. */
export interface ComposerHandle {
  /** Discard like Esc would (ignored while saving or already closing). */
  discard(): void;
}

export interface ComposerProps {
  /** The root owns Esc (it calls `ref.discard()`) and the "saved" toast (from `onClose`). */
  ref?: Ref<ComposerHandle>;
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
  /**
   * Called once, after the exit animation: `saved` with the stored entry (the root should pulse its pin and
   * leave pick mode), or `discarded` (Esc, click outside, the X, Cancel).
   */
  onClose(result: ComposerResult): void;
}

/** Exit animation length, ms (0 when the user prefers reduced motion). */
const EXIT_MS = 160;

export const toEntryTarget = (t: ResolvedTarget): EntryTarget => ({
  selector: t.selector,
  source: t.source,
  sourceInherited: t.inherited,
  label: t.label,
  component: t.crumb,
});

export function commitTargets(commit: PickCommit): ResolvedTarget[] {
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

/** ": <reason>" for a toast, cut to about 80 characters; empty without a reason. */
const why = (reason?: string) => (reason ? `: ${reason.length > 80 ? `${reason.slice(0, 79)}...` : reason}` : "");

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

/**
 * The composer (DESIGN §7): anchored to the target and growing out of it, clear of the dock. Title is required;
 * ⌘↵ / Ctrl↵ files the entry; a click outside, Cancel or the X discards it (Esc is the root's, through `ref`).
 * Renders its own CSS, and must be inside the shadow root (it uses the menu primitive's portal container).
 *
 * On save it reads the capture context, takes the snapshot, builds the entry, and hands it to `store.create`
 * (which numbers it, runs the plugins' `redact`, persists it and emits `entry:created`). If a redact plugin fails
 * nothing is stored: the composer stays open with the reason, and the user's text is kept.
 */
export function Composer({
  ref,
  commit,
  surface,
  viewport,
  size,
  rotated,
  route,
  capture,
  store,
  plugins,
  onClose,
}: ComposerProps) {
  const container = useShadowContainer();
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
      // The exit animation outlives the keypress: let go of focus now, so a field inside the (already inert)
      // composer doesn't swallow the next shortcut.
      const root = rootRef.current;
      const active = (root?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
      if (root && active && root.contains(active)) (active as HTMLElement).blur();
      setLeaving(true);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => onCloseRef.current(result), reducedMotion() ? 0 : EXIT_MS);
    },
    [],
  );
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const discard = useCallback(() => {
    if (savingRef.current) return;
    finish({ type: "discarded" });
  }, [finish]);
  const discardRef = useRef(discard);
  discardRef.current = discard;
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

  // Clicking outside discards, unless it landed in a menu or a toast. The listener is added a tick late so the
  // press that opened the composer can't close it.
  useEffect(() => {
    const onDown = (e: Event) => {
      if (openMenus.current.size > 0) return;
      const path = e.composedPath();
      if (rootRef.current && path.includes(rootRef.current)) return;
      if (path.some((n) => n instanceof Element && (n.classList.contains("menu") || n.classList.contains("toast")))) return;
      discardRef.current();
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => {
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
        const shot = await capture.snapshot(surface, resolved[0]?.el, plugins?.flatMap((p) => p.redactSnapshot ?? []));
        if (shot.redactFailed) toast("Snapshot hidden: it couldn't be redacted.");
        else if (!shot.element && !shot.viewport) toast(`Saved without a screenshot${why(shot.error)}`);
        else if (resolved[0]?.el && !shot.element) toast(`Saved without the element screenshot${why(shot.elementError ?? shot.error)}`);
        if (shot.element || shot.viewport) {
          snapshot = { fontsEmbedded: shot.fontsEmbedded, ...(shot.element ? { element: shot.element } : {}), ...(shot.viewport ? { viewport: shot.viewport } : {}) };
        }
      } catch {
        // An entry without a picture is better than no entry.
      }
      const session = store.getState().session;
      const buildLine = (session.branch ? (session.sha ? `${session.branch}@${session.sha}` : session.branch) : undefined);
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
      toast("Couldn’t save this entry", { icon: <Icon name="x" /> });
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

  // ---- menus
  const track = (name: string) => (open: boolean) => {
    if (open) openMenus.current.add(name);
    else openMenus.current.delete(name);
  };

  const items = propertyItems({ intent, priority, tags: selectedTags, plan }, DEFAULT_TAGS, planSections);

  const name = targetName(commit.kind, resolved.length, primary?.label ?? "");
  const fileText = !primary ? "page-level" : (primary.source ?? "no source (nothing is stamped here)");
  const errId = "pm-title-error";

  return (
    <>
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
                onClick={() => void copyText(primary.source ?? "", `Copied ${shortSource(primary.source ?? "")}`, container)}
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
            <Icon name="x" size="s" />
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
          <PropMenu
            prop="intent"
            items={items.intent}
            onSelect={(k) => setIntent(k as EntryIntent)}
            onOpenChange={track("intent")}
            trigger={
              <Chip as="button" icon={<Icon name={intent} size="s" />}>
                {INTENT_LABEL[intent]}
              </Chip>
            }
          />
          <PropMenu
            prop="priority"
            items={items.priority}
            onSelect={(k) => setPriority(k as EntryPriority)}
            onOpenChange={track("priority")}
            trigger={
              <Chip as="button" icon={<PriorityIcon priority={priority} />}>
                {PRIORITY_LABEL[priority]}
              </Chip>
            }
          />
          <PropMenu
            prop="tags"
            items={items.tags}
            onSelect={(k) => setSelectedTags((cur) => (cur.includes(k) ? cur.filter((t) => t !== k) : [...cur, k]))}
            onOpenChange={track("tags")}
            trigger={
              <Chip as="button" icon={<Icon name="tag" size="s" />}>
                {selectedTags.length ? selectedTags.join(", ") : "Tags"}
              </Chip>
            }
          />
          {planSections.length > 0 ? (
            <PropMenu
              prop="plan"
              items={items.plan}
              onSelect={(k) => setPlan(k === NO_PLAN_KEY ? null : k)}
              onOpenChange={track("plan")}
              trigger={
                <Chip as="button" icon={<Icon name="plan" size="s" />}>
                  {plan ?? "Test plan"}
                </Chip>
              }
            />
          ) : null}
          {task ? (
            <Chip accent icon={<Icon name="code" size="s" />} title="Task, from the host's plugin">
              {task}
            </Chip>
          ) : null}
        </div>

        <details className="pm-ctx">
          <summary>
            <Icon name="layers" size="s" />
            <span>
              Context attached: {plural(preview.console.length, "console line", "console lines")},{" "}
              {plural(preview.network.length, "request", "requests")}, <span className="pm-bad">{failed} failed</span>
            </span>
            <span className="pm-car">
              <Icon name="chev" size="s" />
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
                  <LogRows console={preview.console} />
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
                  <LogRows network={preview.network} bad={(n) => !n.ok} />
                )}
              </div>
            </div>
          </div>
        </details>

        <div className="pm-comp-ft">
          <span className="pm-hint">
            <Icon name="file" size="xs" />
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
