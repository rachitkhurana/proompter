import { useState, type ComponentPropsWithRef, type ReactNode } from "react";
import type { CaptureNetworkEntry } from "../../core/capture/types";
import type { Entry, EntryActivity, EntryStatus, Session } from "../../core/entry";
import type { EntryPatch } from "../proompter-deps";
import { Icon } from "../icons";
import { Button, IconButton } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { STATUS_LABEL, StatusIcon } from "../primitives/status-icon";
import { toast } from "../primitives/toast";
import { shortSource } from "../../core/resolve";
import { LogRows, PropMenu, propertyItems } from "../entry-parts";
import { INTENT_LABEL, NO_PLAN_KEY, targetName } from "../labels";
import { useShadowContainer } from "../shadow-root";
import { copyText } from "../shell/clipboard";
import { clock, sizeLabel, viewportLabel } from "../shell/format";
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

const isFailed = (n: CaptureNetworkEntry) => n.status === null || n.status >= 400;

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
  const resolved = entry.status === "resolved";
  const fails = entry.context.network.filter(isFailed);
  const crumbParts = (t?.component || targetName(entry.kind, entry.targets.length, t?.label ?? "")).split("›").map((x) => x.trim());

  const copy = (text: string, ok: string) => void copyText(text, ok, container);

  const tags = Array.from(new Set([...tagOptions, ...entry.tags]));
  const plans = Array.from(new Set([...planOptions, ...(entry.testPlan ? [entry.testPlan] : [])]));

  const items = propertyItems({ ...entry, plan: entry.testPlan ?? null }, tags, plans);

  const elementLabel = entry.targets.length > 1 ? `${entry.targets.length} elements` : t?.label || "element";
  const selectors = entry.targets.map((x) => x.selector).filter(Boolean);

  return (
    <div className="tk">
      <style>{TICKET_CSS}</style>
      <div className="tk-crumb">
        <IconButton label="Back to entries" onClick={onBack}>
          <Icon name="back" size="s" />
        </IconButton>
        <span className="ttl">{session.title}</span>
        <Icon name="chev" size="xs" />
        <b className="mono">{entry.id}</b>
        <span className="sp" />
        <IconButton label="Copy file path" onClick={() => copy(path, "Copied the file path")}>
          <Icon name="link" size="s" />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <Icon name="x" size="s" />
        </IconButton>
      </div>

      <div className="sh-bd" style={{ boxShadow: "none" }}>
        <div className="tk-main">
          <h2 className="tk-title">{entry.title}</h2>
          {entry.quote ? <div className="quote">“{entry.quote}”</div> : null}
          {entry.description ? <p className="tk-desc">{entry.description}</p> : null}
        </div>

        <div className="tk-sec">
          <h3>Properties</h3>
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <PropMenu
                prop="status"
                items={items.status}
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
              <PropMenu
                prop="priority"
                items={items.priority}
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
              <PropMenu
                prop="intent"
                items={items.intent}
                onSelect={(k) => onUpdate({ intent: k as Entry["intent"] })}
                trigger={
                  <Value aria-label={`Intent: ${INTENT_LABEL[entry.intent]}`}>
                    <Icon name={entry.intent} size="s" />
                    <span>{INTENT_LABEL[entry.intent]}</span>
                  </Value>
                }
              />
            </dd>
            <dt>Viewport</dt>
            <dd>
              {/* The prototype's Viewport row goes to where the entry was filed; the size it was filed at is not editable. */}
              <Value aria-label={`Viewport: ${viewportLabel(entry.viewport)} ${sizeLabel(entry)}. Show on page`} onClick={onShow}>
                <Icon name={entry.viewport} size="s" />
                <span>
                  {viewportLabel(entry.viewport)} <span className="num mute">{sizeLabel(entry)}</span>
                </span>
              </Value>
            </dd>
            <dt>Tags</dt>
            <dd>
              <PropMenu
                prop="tags"
                items={items.tags}
                onSelect={(tag) =>
                  onUpdate({
                    tags: entry.tags.includes(tag) ? entry.tags.filter((x) => x !== tag) : [...entry.tags, tag],
                  })
                }
                trigger={
                  <Value aria-label={`Tags: ${entry.tags.length ? entry.tags.join(", ") : "none"}`}>
                    <Icon name="tag" size="s" />
                    <span>{entry.tags.length ? entry.tags.join(", ") : <span className="mute">Add tags</span>}</span>
                  </Value>
                }
              />
            </dd>
            {plans.length > 0 ? (
              <>
                <dt>Test plan</dt>
                <dd>
                  <PropMenu
                    prop="plan"
                    items={items.plan}
                    onSelect={(k) => onUpdate({ testPlan: k === NO_PLAN_KEY ? null : k })}
                    trigger={
                      <Value aria-label={`Test plan: ${entry.testPlan ?? "not linked"}`}>
                        <Icon name="plan" size="s" />
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
                  <Icon name="gh" size="s" />
                  <span>{entry.issue}</span>
                </span>
              ) : canOpenIssue ? (
                <Value onClick={onOpenIssue}>
                  <Icon name="gh" size="s" />
                  <span className="mute">Open an issue</span>
                </Value>
              ) : (
                <span className="val ro">
                  <Icon name="gh" size="s" />
                  <span className="mute">Not opened · v2</span>
                </span>
              )}
            </dd>
          </dl>
        </div>

        <div className="tk-sec">
          <h3>Where</h3>
          <div className="crumbs">
            {crumbParts.map((part, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 ? <Icon name="chev" size="xs" /> : null}
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
                    <Icon name="code" size="s" />
                    <span>
                      {t.sourceInherited ? "↳ " : ""}
                      {shortSource(t.source)}
                    </span>
                    <Icon name="copy" size="xs" />
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
                    <Icon name="copy" size="xs" />
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
          <h3>
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
          </h3>
          <div className="log" role="tabpanel" aria-label={ctx === "console" ? "Console" : "Network"}>
            {ctx === "console" ? (
              entry.context.console.length ? (
                <LogRows console={entry.context.console} />
              ) : (
                <span className="log-none">No console errors or warnings were captured.</span>
              )
            ) : entry.context.network.length ? (
              <LogRows network={entry.context.network} bad={isFailed} />
            ) : (
              <span className="log-none">No requests were captured.</span>
            )}
          </div>
        </div>

        <div className="tk-sec">
          <h3>Activity</h3>
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
          <h3>
            File
            <span className="sp" />
            <Button variant="ghost" size="sm" aria-expanded={showMd} onClick={() => setShowMd((v) => !v)}>
              {showMd ? "Hide" : "Show"} markdown
            </Button>
          </h3>
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
          <Icon name="eye" size="s" />
          Show on page
        </Button>
        <Button
          onClick={() => copy(serialize(entry), `Copied ${entry.id} as a prompt for an agent`)}
        >
          <Icon name="sparkle" size="s" />
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
