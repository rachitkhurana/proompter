import type { ReactNode } from "react";
import type { Entry } from "../../core/entry";
import type { PickMode } from "../../core/pick";
import { VIEWPORT_ORDER, VIEWPORTS, type ViewportId } from "../../core/surface";
import { FreezeIcon, InboxIcon, PublishIcon, icons } from "../icons";
import { Kbd } from "../primitives/kbd";
import { PriorityIcon } from "../primitives/priority-icon";
import { viewportLabel } from "../shell/format";

export interface CommandItem {
  id: string;
  section: string;
  icon: ReactNode;
  label: string;
  sub: string;
  right?: ReactNode;
  run(): void;
}

export type CommandTool = Exclude<PickMode, "idle">;

export interface CommandContext {
  viewport: ViewportId;
  frozen: boolean;
  entries: readonly Entry[];
  /** Files waiting to be written, for the Publish line. */
  pendingFiles: number;
  onTool(tool: CommandTool): void;
  onFreeze(): void;
  onViewport(v: ViewportId): void;
  onOpenEntry(id: string): void;
  onAllEntries(): void;
  onPublish(): void;
}

const TOOLS: ReadonlyArray<{ tool: CommandTool; icon: keyof typeof icons; label: string; key: string }> = [
  { tool: "pick", icon: "pick", label: "Pick element", key: "P" },
  { tool: "multi", icon: "multi", label: "Select several elements", key: "M" },
  { tool: "box", icon: "area", label: "Box select", key: "B" },
  { tool: "text", icon: "text", label: "Quote text", key: "T" },
  { tool: "note", icon: "note", label: "Page note", key: "N" },
];

/**
 * Everything the command menu can run, in the prototype's order and sections: Review (tools, freeze),
 * Viewport, Entries (open ones, newest first), Session (all entries, publish).
 */
export function buildCommandItems(c: CommandContext): CommandItem[] {
  const out: CommandItem[] = [];
  const here = `on ${viewportLabel(c.viewport).toLowerCase()}`;

  for (const t of TOOLS) {
    const Icon = icons[t.icon];
    out.push({
      id: `tool-${t.tool}`,
      section: "Review",
      icon: <Icon size="s" />,
      label: t.label,
      sub: here,
      right: <Kbd>{t.key}</Kbd>,
      run: () => c.onTool(t.tool),
    });
  }
  out.push({
    id: "freeze",
    section: "Review",
    icon: <FreezeIcon size="s" />,
    label: c.frozen ? "Resume motion" : "Freeze motion",
    sub: "pause animations on the page",
    right: <Kbd>F</Kbd>,
    run: c.onFreeze,
  });

  VIEWPORT_ORDER.forEach((v, i) => {
    const Icon = icons[v];
    const size = VIEWPORTS[v].size;
    out.push({
      id: `viewport-${v}`,
      section: "Viewport",
      icon: <Icon size="s" />,
      label: VIEWPORTS[v].label,
      sub: size ? `${size[0]}×${size[1]}` : "fills the window",
      right: c.viewport === v ? "Current" : <Kbd>{String(i + 1)}</Kbd>,
      run: () => c.onViewport(v),
    });
  });

  c.entries
    .filter((e) => e.status !== "resolved")
    .slice()
    .reverse()
    .forEach((e) => {
      const Icon = icons[e.viewport];
      out.push({
        id: `entry-${e.id}`,
        section: "Entries",
        icon: <PriorityIcon priority={e.priority} />,
        label: e.title,
        sub: `${e.id} · ${viewportLabel(e.viewport)}`,
        right: <Icon size="s" />,
        run: () => c.onOpenEntry(e.id),
      });
    });

  out.push({
    id: "all-entries",
    section: "Session",
    icon: <InboxIcon size="s" />,
    label: "All entries",
    sub: `${c.entries.length} in this session`,
    right: <Kbd>E</Kbd>,
    run: c.onAllEntries,
  });
  out.push({
    id: "publish",
    section: "Session",
    icon: <PublishIcon size="s" />,
    label: "Publish session",
    sub: `${c.pendingFiles} file${c.pendingFiles === 1 ? "" : "s"} to write`,
    run: c.onPublish,
  });
  return out;
}

/** The prototype's match: the query is a substring of `label + " " + sub`, ignoring case. */
export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((it) => `${it.label} ${it.sub}`.toLowerCase().includes(q));
}
