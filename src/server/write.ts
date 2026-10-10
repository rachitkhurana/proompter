/**
 * Writing and reading `reviews/<session>/` on disk, shared by the dev route and (later) the CLI.
 * Every path goes through `guardPath`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Entry, Session } from "../core/entry";
import { assetNames, entryPath, pad, parse, serialize } from "../core/serialize";
import { SESSION_ID } from "../core/store";
import { decodePng, Refusal } from "./validate";

export const ENTRY_FILE = /^entries\/\d{3,5}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export const ASSET_FILE = /^assets\/\d{3,5}-(?:responsive|desktop|tablet|mobile)(?:-full)?\.png$/;

/**
 * Turn `(session, rel)` into an absolute file path that is guaranteed to be a regular (non-symlink) file
 * location inside `<cwd>/reviews/<session>/`, creating the folders on the way. Throws `Refusal` otherwise.
 *
 * 1. Allow-list, not block-list: `session` must match T07's `SESSION_ID`, and `rel` must be exactly
 *    `session.md`, `entries/NNN-slug.md` or `assets/NNN-<viewport>[-full].png`. Those patterns contain only
 *    `[a-z0-9-/.]`, so `..` segments, absolute paths, NUL, backslashes and percent-encoded traversal
 *    (`%2e%2e`) cannot match.
 * 2. `path.resolve` must stay inside the session folder (belt and braces for 1).
 * 3. Symlinks: the real path of `reviews/`, of the session folder and of the file's parent folder must all
 *    stay inside `realpath(cwd)/reviews/<session>`, and the file itself must not be a symlink.
 */
export async function guardPath(cwd: string, session: unknown, rel: unknown): Promise<string> {
  if (typeof session !== "string" || !SESSION_ID.test(session)) throw new Refusal("bad session id");
  if (typeof rel !== "string" || !(rel === "session.md" || ENTRY_FILE.test(rel) || ASSET_FILE.test(rel))) {
    throw new Refusal("bad file path");
  }
  const root = path.resolve(cwd, "reviews");
  const base = path.resolve(root, session);
  const target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep)) throw new Refusal("path escapes the session folder");

  // Create and verify one level at a time, so nothing is ever created through a symlink.
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  if (realRoot !== path.join(await fs.realpath(cwd), "reviews")) throw new Refusal("reviews/ is a symlink");
  await fs.mkdir(base, { recursive: true });
  const realBase = await fs.realpath(base);
  if (realBase !== path.join(realRoot, session)) throw new Refusal("session folder is a symlink");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const realParent = await fs.realpath(path.dirname(target));
  if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) throw new Refusal("folder is a symlink");
  const st = await fs.lstat(target).catch(() => null);
  if (st && (st.isSymbolicLink() || !st.isFile())) throw new Refusal("target is not a regular file");
  return target;
}

// ---------------------------------------------------------------------------------------------------------
// Writing

/** Write `data` unless the file already holds exactly that. Temp file + rename. Returns whether it wrote. */
export async function writeAtomic(file: string, data: string | Buffer): Promise<boolean> {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const old = await fs.readFile(file).catch(() => null);
  if (old && old.equals(buf)) return false;
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, buf, { flag: "wx" });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return true;
}

/** What one entry becomes: its file, its PNGs (keyed by repo-relative path) and the element crop to remove. */
export interface EntryPlan {
  /** `entries/NNN-slug.md`, relative to the session folder. */
  rel: string;
  markdown: string;
  /** `assets/NNN-*.png` -> bytes, only for images that came with this request. */
  png: Map<string, Buffer>;
  /** `assets/NNN-*.png` of an element crop the entry no longer links, else null. */
  staleElement: string | null;
}

/** Validate the images and serialize the entry. Pure: the disk (or GitHub) is the caller's business. */
export function planEntry(session: Session, input: Entry): EntryPlan {
  const names = assetNames(input.n, input.viewport);
  const element = decodePng(input.snapshot?.element);
  const full = decodePng(input.snapshot?.viewport);
  // The file names come from (n, viewport), never from the client, and the links are rewritten to match.
  const assets = {
    ...(element || input.snapshot?.assets?.element ? { element: names.element } : {}),
    ...(full || input.snapshot?.assets?.viewport ? { viewport: names.viewport } : {}),
  };
  const entry: Entry = { ...input, snapshot: { ...input.snapshot, assets } };
  let markdown: string;
  try {
    markdown = serialize(entry, session);
  } catch {
    throw new Refusal("entry could not be serialized");
  }
  const png = new Map<string, Buffer>();
  if (element) png.set(`assets/${names.element}`, element);
  if (full) png.set(`assets/${names.viewport}`, full);
  return { rel: entryPath(entry), markdown, png, staleElement: assets.element ? null : `assets/${names.element}` };
}

/** Write one entry (+ its images). Returns the paths, relative to the session folder, that changed. */
export async function writeEntry(cwd: string, session: Session, input: Entry): Promise<string[]> {
  const changed: string[] = [];
  const put = async (rel: string, data: string | Buffer) => {
    if (await writeAtomic(await guardPath(cwd, session.id, rel), data)) changed.push(rel);
  };
  const plan = planEntry(session, input);
  for (const [rel, bytes] of plan.png) await put(rel, bytes);
  // The entry no longer links an element crop: remove the one left over from an earlier version.
  if (plan.staleElement) {
    const old = await guardPath(cwd, session.id, plan.staleElement);
    if (await fs.lstat(old).then(() => true, () => false)) {
      await fs.rm(old, { force: true });
      changed.push(plan.staleElement);
    }
  }

  const rel = plan.rel;
  await put(rel, plan.markdown);

  // A renamed title is a new file name: delete the old `NNN-*.md` of the same number.
  const dir = path.dirname(await guardPath(cwd, session.id, rel));
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith(`${pad(input.n)}-`) && ENTRY_FILE.test(`entries/${name}`) && `entries/${name}` !== rel) {
      await fs.rm(path.join(dir, name), { force: true });
      changed.push(`entries/${name}`);
    }
  }
  return changed;
}

/** Entries on disk for a session folder, parsed (unreadable or malformed files are skipped). */
export async function readEntries(sessionDir: string): Promise<{ path: string; markdown: string; entry: Entry }[]> {
  const out: { path: string; markdown: string; entry: Entry }[] = [];
  const dirents = await fs.readdir(path.join(sessionDir, "entries"), { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    const rel = `entries/${d.name}`;
    if (!d.isFile() || !ENTRY_FILE.test(rel)) continue; // isFile() is false for symlinks
    try {
      const file = path.join(sessionDir, rel);
      if (!(await fs.lstat(file)).isFile()) continue; // lstat: a symlink is skipped, never followed
      const markdown = await fs.readFile(file, "utf8");
      out.push({ path: rel, markdown, entry: parse(markdown) });
    } catch {
      // not ours / hand-edited into something unparsable: leave it alone
    }
  }
  return out.sort((a, b) => a.entry.n - b.entry.n);
}

/** One write at a time per session folder: concurrent renames and index rebuilds must not interleave. */
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}
