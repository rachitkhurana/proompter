/**
 * Source mapping (DESIGN §4): turn a DOM element into what an entry records.
 * Framework-free. Works on any `Document`, including an iframe's.
 */

/** Tag of the element that hosts the kit's shadow root. Anything inside it is never pickable. */
export const KIT_HOST_TAG = "proompter-root";

/** Smallest element (CSS px, both sides) the picker will land on. */
export const MIN_TARGET_SIZE = 6;

const ROOT_TAGS = new Set(["html", "body", "head"]);

/** True when `node` is the kit host or lives inside it (light DOM or shadow tree). */
export function isInKit(node: Node | null | undefined): boolean {
  let n: Node | null | undefined = node;
  while (n) {
    if (n.nodeType === 1 && (n as Element).localName === KIT_HOST_TAG) return true;
    // A shadow root has no parentNode but points at its host.
    n = n.parentNode ?? (n as { host?: Node }).host ?? null;
  }
  return false;
}

/**
 * Climb out of every shadow root to its host. A host app's open shadow roots are opaque to selectors, so the
 * host element is the deepest thing we can name. (Our own shadow root retargets to `<proompter-root>`.)
 */
export function retarget(el: Element): Element {
  let n = el;
  for (;;) {
    const root = n.getRootNode?.() as (Node & { host?: Element }) | undefined;
    if (root && root.nodeType === 11 && root.host) n = root.host;
    else return n;
  }
}

/** The element an event was aimed at (looks through shadow retargeting; text nodes become their parent). */
export function eventElement(e: Event): Element | null {
  const first = typeof e.composedPath === "function" ? e.composedPath()[0] : undefined;
  const node = (first as Node | undefined) ?? (e.target as Node | null);
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/**
 * Deepest element at or above `node` that is at least 6x6 px and not html/body.
 * Our own UI is never a target. There is no "component boundary" rule: the deepest element wins.
 */
export function targetFor(node: Node | null | undefined): Element | null {
  let el: Element | null = !node ? null : node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (el) el = retarget(el);
  while (el && !ROOT_TAGS.has(el.localName)) {
    if (isInKit(el)) return null;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_TARGET_SIZE && r.height >= MIN_TARGET_SIZE) return el;
    el = el.parentElement;
  }
  return null;
}

/** Parent in the pick tree, or null at the top (html/body are never targets). */
export function parentTarget(el: Element): Element | null {
  const p = el.parentElement;
  if (!p || ROOT_TAGS.has(p.localName) || isInKit(p)) return null;
  return p;
}

// ---------------------------------------------------------------------------------------------------------
// Source, label, crumb

const attr = (el: Element, name: string): string | null => el.getAttribute(name);

/** The element carrying the source: itself, else the nearest stamped ancestor. */
export function anchorOf(el: Element): Element | null {
  return el.closest("[data-src]");
}

/** `path/to/post-card.tsx:48:7` -> `post-card.tsx:48:7`. */
export function shortSource(source: string): string {
  return source.split("/").pop() ?? source;
}

const CLASS_HINTS = [
  "avatar",
  "thumbnail",
  "thumb",
  "media",
  "image",
  "input",
  "pill",
  "badge",
  "icon",
  "logo",
  "chip",
  "cover",
  "equaliser",
  "equalizer",
];

function hintOf(el: Element): string {
  const tokens = (attr(el, "class") ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const byClass = CLASS_HINTS.find((h) => tokens.includes(h));
  if (byClass) return byClass;
  const tag = el.localName;
  if (tag === "img") return (attr(el, "alt") ?? "").trim().slice(0, 20);
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return (attr(el, "placeholder") ?? attr(el, "name") ?? attr(el, "aria-label") ?? "").trim().slice(0, 20);
  }
  return "";
}

const squash = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * Human label: the component name if stamped, else tag plus a hint:
 * `img · avatar`, `button “Share”`, `p “Clutched a 1v4…”`.
 */
export function labelOf(el: Element): string {
  const comp = attr(el, "data-comp");
  if (comp) return lastComp(comp);
  const tag = el.localName;
  const hint = hintOf(el);
  if (hint) return `${tag} · ${hint}`;
  const txt = squash(el.textContent);
  if ((tag === "button" || tag === "a") && txt) return `${tag} “${txt.slice(0, 16)}${txt.length > 16 ? "…" : ""}”`;
  if (txt && el.children.length === 0) return `${tag} “${txt.slice(0, 20)}${txt.length > 20 ? "…" : ""}”`;
  return tag;
}

const splitComp = (v: string) =>
  v
    .split("›")
    .map((s) => s.trim())
    .filter(Boolean);
const lastComp = (v: string) => splitComp(v).pop() ?? v.trim();

/** Component chain (outermost first) from the `data-comp` ancestors, then the element's own label if it is not a component root. */
export function crumbPartsOf(el: Element): string[] {
  const chain: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = attr(n, "data-comp");
    if (c) chain.unshift(...splitComp(c));
  }
  const parts = chain.filter((name, i) => name !== chain[i - 1]);
  if (!attr(el, "data-comp")) parts.push(labelOf(el));
  return parts;
}

// ---------------------------------------------------------------------------------------------------------
// Selector

const srcSelector = (src: string) =>
  `[data-src="${src.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"]`;

function count(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function typeIndex(el: Element): number {
  let i = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === el.localName) i++;
  return i;
}

const step = (el: Element) => `${el.localName}:nth-of-type(${typeIndex(el)})`;

/** Position-only chain from `body` (always unique, but brittle). */
function fullChain(el: Element, doc: Document): string {
  const parts: string[] = [];
  let n: Element | null = el;
  while (n && n !== doc.body && n !== doc.documentElement) {
    parts.unshift(step(n));
    n = n.parentElement;
  }
  return `${n === doc.documentElement ? "html" : "body"} > ${parts.join(" > ")}`;
}

/**
 * Shortest unique selector for `el`.
 * 1. its own `data-src`, if exactly one element in the document has that value;
 * 2. otherwise an `nth-of-type` chain anchored at the nearest ancestor whose `data-src` is unique;
 * 3. otherwise the full chain from `body`.
 * The result is verified: it matches exactly `el`.
 */
export function selectorFor(target: Element): string {
  const el = retarget(target);
  const doc = el.ownerDocument;
  const own = attr(el, "data-src");
  if (own) {
    const s = srcSelector(own);
    if (count(doc, s) === 1) return s;
  }
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
    if (n !== el) {
      const src = attr(n, "data-src");
      if (src) {
        const s = srcSelector(src);
        if (count(doc, s) === 1) {
          const candidate = `${s} > ${parts.join(" > ")}`;
          if (isExactly(doc, candidate, el)) return candidate;
          break;
        }
      }
    }
    parts.unshift(step(n));
  }
  return fullChain(el, doc);
}

function isExactly(doc: Document, selector: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** Re-resolve a stored selector. Null when it matches nothing, or is invalid. */
export function findBySelector(doc: Document, selector: string | null | undefined): Element | null {
  if (!selector) return null;
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Public shape

/** The cheap part, enough for the hover label. */
export interface TargetInfo {
  el: Element;
  /** `file:line:col` from the element's own `data-src`, else the nearest stamped ancestor's. Null when nothing is stamped. */
  source: string | null;
  /** True when `source` came from an ancestor (the UI prefixes `↳`). */
  inherited: boolean;
  label: string;
}

export interface ResolvedTarget extends TargetInfo {
  /** Shortest unique selector; re-resolves to `el` with `findBySelector`. */
  selector: string;
  /** Component chain down to the element, joined with ` › `. */
  crumb: string;
  crumbParts: string[];
  /** Reserved for the query-cache adapter. */
  query?: string;
}

export function describeTarget(el: Element): TargetInfo {
  const a = anchorOf(el);
  return { el, source: a ? attr(a, "data-src") : null, inherited: !!a && a !== el, label: labelOf(el) };
}

/** `resolveTarget(el) -> { el, selector, source, inherited, label, crumb, query? }` (DESIGN §4). */
export function resolveTarget(target: Element): ResolvedTarget {
  const el = retarget(target);
  const parts = crumbPartsOf(el);
  return { ...describeTarget(el), selector: selectorFor(el), crumb: parts.join(" › "), crumbParts: parts };
}
