import { useState, type ComponentPropsWithRef, type ReactNode } from "react";
import type { Entry, EntryActivity, EntryStatus, Session } from "../../core/entry";
import type { EntryPatch } from "../proompter-deps";
import {
  BackIcon,
  ChevIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  GhIcon,
  LinkIcon,
  PlanIcon,
  SparkleIcon,
  TagIcon,
  XIcon,
  icons,
} from "../icons";
import { Button, IconButton } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { Menu, type MenuItem } from "../primitives/menu";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { STATUS_LABEL, StatusIcon } from "../primitives/status-icon";
import { toast } from "../primitives/toast";
import { useShadowContainer } from "../shadow-root";
import { copyText } from "../shell/clipboard";
import { clock, clockSeconds, shortSource, sizeLabel, viewportLabel } from "../shell/format";
import { INTENT_LABEL, INTENTS, PRIORITIES, STATUSES } from "./labels";
import { Snapshot } from "./snapshot";
import { TabList } from "./tab-list";
import { TICKET_CSS } from "./ticket-css";

export interface TicketProps {
  entry: Entry;
  session: Session;
  /** DESIGN §8 text of the entry (File preview and Copy for agent). */
  serialize(entry: Entry): string;
  /** Repo-relative file path, shown under File and copied by the link button. */
  path: string;
  /** Tags offered by the Tags menu (tags already on the entry are always added). */
  tagOptions: readonly string[];
  /** Test plan sections (from plugins). The row is hidden when there are none and nothing is linked. */
  planOptions: readonly string[];
  /** Whether a GitHub issue can be opened from here (v2). */
  canOpenIssue?: boolean;
  onBack(): void;
  onClose(): void;
  onShow(): void;
  onUpdate(patch: EntryPatch): void;
  onResolve(): void;
  onOpenIssue?(): void;
}

/** What the "Where" section names when the entry has no component chain. */
export function targetName(entry: Entry): string {
  const n = entry.targets.length;
  switch (entry.kind) {
    case "note":
      return "Page note";
    case "text":
      return "Quoted text";
    case "multi":
      return `${n} element${n === 1 ? "" : "s"}`;
    case "box":
      return `${n} element${n === 1 ? "" : "s"} in a box`;
    default:
      return entry.target?.label || "Element";
  }
}

const NONE = "__none__";

/** A property value that opens a menu or runs an action (`.val`). Forwards its ref, so it can trigger a Menu. */
function Value({ className = "val", ...rest }: ComponentPropsWithRef<"button">) {
  return <button type="button" {...rest} className={className} />;
}

function activityText(a: EntryActivity, entry: Entry): ReactNode {
  const who = <b>{a.who}</b>;
  if (a.text === "created") {
    return (
      <>
        {who} filed this on {viewportLabel(entry.viewport).toLowerCase()} {sizeLabel(entry)}
      </>
    );
  }
  if (/^status: .* → resolved$/.test(a.text)) return <>{who} marked it resolved</>;
  if (/^status: resolved → /.test(a.text)) return <>{who} reopened it</>;
  return (
    <>
      {who} {a.text}
    </>
  );
}

/**
 * The entry detail view (DESIGN §7): breadcrumb and title, description, editable properties, where it was
 * filed, captured context, activity, the file, and the footer actions. Renders inside the sheet.
 */
export function Ticket({
  entry,
  session,
  serialize,
  path,
  tagOptions,
  planOptions,
  canOpenIssue,
  onBack,
  onClose,
  onShow,
  onUpdate,
  onResolve,
  onOpenIssue,
}: TicketProps) {
  const container = useShadowContainer();
  const [ctx, setCtx] = useState<"console" | "network">("console");
  const [showMd, setShowMd] = useState(false);

  const t = entry.target;
  const VpIcon = icons[entry.viewport];
  const IntentIcon = icons[entry.intent];
  const resolved = entry.status === "resolved";
  const fails = entry.context.network.filter((n) => n.status === null || n.status >= 400);
  const crumbParts = (t?.component || targetName(entry)).split("›").map((x) => x.trim());

  const copy = (text: string, ok: string) => void copyText(text, ok, container);

  const tags = Array.from(new Set([...tagOptions, ...entry.tags]));
  const plans = Array.from(new Set([...planOptions, ...(entry.testPlan ? [entry.testPlan] : [])]));

  const statusItems: MenuItem[] = STATUSES.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    icon: <StatusIcon status={s} />,
    checked: entry.status === s,
  }));
  const priorityItems: MenuItem[] = PRIORITIES.map((p) => ({
    key: p,
    label: PRIORITY_LABEL[p],
    icon: <PriorityIcon priority={p} />,
    checked: entry.priority === p,
  }));
  const intentItems: MenuItem[] = INTENTS.map(({ value, label }) => {
    const Icon = icons[value];
    return { key: value, label, icon: <Icon size="s" />, checked: entry.intent === value };
  });
  const tagItems: MenuItem[] = tags.map((tag) => ({
    key: tag,
    label: tag,
    icon: <TagIcon size="s" />,
    checked: entry.tags.includes(tag),
  }));
  const planItems: MenuItem[] = [
    { key: NONE, label: "Not linked", checked: !entry.testPlan },
    ...plans.map((p) => ({ key: p, label: p, icon: <PlanIcon size="s" />, checked: entry.testPlan === p })),
  ];

  const elementLabel = entry.targets.length > 1 ? `${entry.targets.length} elements` : t?.label || "element";
  const selectors = entry.targets.map((x) => x.selector).filter(Boolean);

  return (
    <div className="tk">
      <style>{TICKET_CSS}</style>
      <div className="tk-crumb">
        <IconButton label="Back to entries" onClick={onBack}>
          <BackIcon size="s" />
        </IconButton>
        <span className="ttl">{session.title}</span>
        <ChevIcon size="xs" />
        <b className="mono">{entry.id}</b>
        <span className="sp" />
        <IconButton label="Copy file path" onClick={() => copy(path, "Copied the file path")}>
          <LinkIcon size="s" />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <XIcon size="s" />
        </IconButton>
      </div>

      <div className="sh-bd" style={{ boxShadow: "none" }}>
        <div className="tk-main">
          <h2 className="tk-title">{entry.title}</h2>
          {entry.quote ? <div className="quote">“{entry.quote}”</div> : null}
          {entry.description ? <p className="tk-desc">{entry.description}</p> : null}
        </div>

        <div className="tk-sec">
          <h4>Properties</h4>
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <Menu
                selection="single"
                label="Status"
                items={statusItems}
                onSelect={(k) => onUpdate({ status: k as EntryStatus })}
                trigger={
                  <Value aria-label={`Status: ${STATUS_LABEL[entry.status]}`}>
                    <StatusIcon status={entry.status} />
                    <span>{STATUS_LABEL[entry.status]}</span>
                  </Value>
                }
              />
            </dd>
            <dt>Priority</dt>
            <dd>
              <Menu
                selection="single"
                label="Priority"
                items={priorityItems}
                onSelect={(k) => onUpdate({ priority: k as Entry["priority"] })}
                trigger={
                  <Value aria-label={`Priority: ${PRIORITY_LABEL[entry.priority]}`}>
                    <PriorityIcon priority={entry.priority} />
                    <span>{PRIORITY_LABEL[entry.priority]}</span>
                  </Value>
                }
              />
            </dd>
            <dt>Intent</dt>
            <dd>
              <Menu
                selection="single"
                label="Intent"
                items={intentItems}
                onSelect={(k) => onUpdate({ intent: k as Entry["intent"] })}
                trigger={
                  <Value aria-label={`Intent: ${INTENT_LABEL[entry.intent]}`}>
                    <IntentIcon size="s" />
                    <span>{INTENT_LABEL[entry.intent]}</span>
                  </Value>
                }
              />
            </dd>
            <dt>Viewport</dt>
            <dd>
              {/* The prototype's Viewport row goes to where the entry was filed; the size it was filed at is not editable. */}
              <Value aria-label={`Viewport: ${viewportLabel(entry.viewport)} ${sizeLabel(entry)}. Show on page`} onClick={onShow}>
                <VpIcon size="s" />
                <span>
                  {viewportLabel(entry.viewport)} <span className="num mute">{sizeLabel(entry)}</span>
                </span>
              </Value>
            </dd>
            <dt>Tags</dt>
            <dd>
              <Menu
                selection="multiple"
                label="Tags"
                header="Tags"
                items={tagItems}
                onSelect={(tag) =>
                  onUpdate({
                    tags: entry.tags.includes(tag) ? entry.tags.filter((x) => x !== tag) : [...entry.tags, tag],
                  })
                }
                trigger={
                  <Value aria-label={`Tags: ${entry.tags.length ? entry.tags.join(", ") : "none"}`}>
                    <TagIcon size="s" />
                    <span>{entry.tags.length ? entry.tags.join(", ") : <span className="mute">Add tags</span>}</span>
                  </Value>
                }
              />
            </dd>
            {plans.length > 0 ? (
              <>
                <dt>Test plan</dt>
                <dd>
                  <Menu
                    selection="single"
                    label="Test plan"
                    header="Link to the manual test plan"
                    items={planItems}
                    onSelect={(k) => onUpdate({ testPlan: k === NONE ? null : k })}
                    trigger={
                      <Value aria-label={`Test plan: ${entry.testPlan ?? "not linked"}`}>
                        <PlanIcon size="s" />
                        <span>{entry.testPlan ?? <span className="mute">Not linked</span>}</span>
                      </Value>
                    }
                  />
                </dd>
              </>
            ) : null}
            <dt>GitHub</dt>
            <dd>
              {entry.issue ? (
                <span className="val ro">
                  <GhIcon size="s" />
                  <span>{entry.issue}</span>
                </span>
              ) : canOpenIssue ? (
                <Value onClick={onOpenIssue}>
                  <GhIcon size="s" />
                  <span className="mute">Open an issue</span>
                </Value>
              ) : (
                <span className="val ro">
                  <GhIcon size="s" />
                  <span className="mute">Not opened · v2</span>
                </span>
              )}
            </dd>
          </dl>
        </div>

        <div className="tk-sec">
          <h4>Where</h4>
          <div className="crumbs">
            {crumbParts.map((part, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 ? <ChevIcon size="xs" /> : null}
                <span>{part}</span>
              </span>
            ))}
          </div>
          <dl className="kv">
            {t?.source ? (
              <>
                <dt>Source</dt>
                <dd>
                  <Value
                    className="val mono"
                    title={t.sourceInherited ? "Nearest component that renders this element" : undefined}
                    aria-label={`Copy source ${t.sourceInherited ? "(inherited) " : ""}${shortSource(t.source)}`}
                    onClick={() => copy(t.source ?? "", `Copied ${shortSource(t.source ?? "")}`)}
                  >
                    <CodeIcon size="s" />
                    <span>
                      {t.sourceInherited ? "↳ " : ""}
                      {shortSource(t.source)}
                    </span>
                    <CopyIcon size="xs" />
                  </Value>
                </dd>
              </>
            ) : null}
            {selectors.length > 0 ? (
              <>
                <dt>Element</dt>
                <dd>
                  <Value
                    className="val mono"
                    title={selectors.join("\n")}
                    aria-label={`Copy element selector: ${elementLabel}`}
                    onClick={() => copy(selectors.join("\n"), "Copied the element selector")}
                  >
                    <span>{elementLabel}</span>
                    <CopyIcon size="xs" />
                  </Value>
                </dd>
              </>
            ) : null}
            {entry.task ? (
              <>
                <dt>Task</dt>
                <dd>
                  <Chip accent>{entry.task}</Chip>
                </dd>
              </>
            ) : null}
            <dt>Route</dt>
            <dd>
              <span className="val ro mono">
                <span>{entry.route}</span>
              </span>
            </dd>
          </dl>
          <Snapshot entry={entry} onShow={onShow} />
        </div>

        <div className="tk-sec">
          <h4>
            Captured context
            <span className="sp" />
            <TabList
              label="Captured context"
              value={ctx}
              onValueChange={setCtx}
              items={[
                { value: "console", label: "Console" },
                {
                  value: "network",
                  label: (
                    <>
                      Network {fails.length > 0 ? <span className="bad num">{fails.length}</span> : null}
                    </>
                  ),
                },
              ]}
            />
          </h4>
          <div className="log" role="tabpanel" aria-label={ctx === "console" ? "Console" : "Network"}>
            {ctx === "console" ? (
              entry.context.console.length ? (
                entry.context.console.map((c, i) => (
                  <div key={i}>
                    <span className="m">{clockSeconds(c.timestamp)}</span>
                    <span className={c.level === "error" ? "e" : "w"}>{c.level}</span>
                    <span title={c.message}>{c.message}</span>
                  </div>
                ))
              ) : (
                <span className="log-none">No console errors or warnings were captured.</span>
              )
            ) : entry.context.network.length ? (
              entry.context.network.map((n, i) => {
                const bad = n.status === null || n.status >= 400;
                return (
                  <div key={i}>
                    <span className={bad ? "e" : "g"}>{n.status ?? "ERR"}</span>
                    <span className="m num">{Math.round(n.durationMs)}ms</span>
                    <span title={n.url}>
                      {n.method} {n.url}
                    </span>
                  </div>
                );
              })
            ) : (
              <span className="log-none">No requests were captured.</span>
            )}
          </div>
        </div>

        <div className="tk-sec">
          <h4>Activity</h4>
          <div className="act">
            {entry.activity.map((a, i) => (
              <div key={i}>
                <span className="dot">
                  <i />
                </span>
                <span>{activityText(a, entry)}</span>
                <time dateTime={a.at}>{clock(a.at)}</time>
              </div>
            ))}
          </div>
        </div>

        <div className="tk-sec">
          <h4>
            File
            <span className="sp" />
            <Button variant="ghost" size="sm" aria-expanded={showMd} onClick={() => setShowMd((v) => !v)}>
              {showMd ? "Hide" : "Show"} markdown
            </Button>
          </h4>
          {showMd ? (
            <pre className="md" tabIndex={0} aria-label="Entry markdown">
              {serialize(entry)}
            </pre>
          ) : (
            <span className="hint mono">{path}</span>
          )}
        </div>
      </div>

      <div className="sh-ft">
        <Button onClick={onShow}>
          <EyeIcon size="s" />
          Show on page
        </Button>
        <Button
          onClick={() => copy(serialize(entry), `Copied ${entry.id} as a prompt for an agent`)}
        >
          <SparkleIcon size="s" />
          Copy for agent
        </Button>
        <span className="sp" />
        <Button
          variant={resolved ? "default" : "pri"}
          onClick={() => {
            if (resolved) {
              onUpdate({ status: "open" });
              toast(`${entry.id} reopened`);
            } else {
              onResolve();
              toast(`${entry.id} resolved`);
            }
          }}
        >
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
    </div>
  );
}
