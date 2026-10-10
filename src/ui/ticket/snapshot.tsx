import { useState } from "react";
import type { Entry } from "../../core/entry";
import { Icon } from "../icons";
import { Button } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { cx } from "../primitives/cx";
import { sizeLabel, snapshotFile, viewportLabel } from "../shell/format";

type Mode = "element" | "viewport";

export interface SnapshotProps {
  entry: Entry;
  /** "Show on mobile": switch to the size the entry was filed on. */
  onShow(): void;
}

/**
 * The ticket's snapshot: the element crop and the visible viewport, both PNGs from capture, with the
 * prototype's Element/Viewport toggle. With no PNG it says where the entry was filed and offers to go there.
 */
export function Snapshot({ entry, onShow }: SnapshotProps) {
  const snap = entry.snapshot;
  const hasElement = !!snap?.element;
  const hasViewport = !!snap?.viewport;
  const [picked, setPicked] = useState<Mode>("element");
  const mode: Mode = picked === "element" && hasElement ? "element" : hasViewport ? "viewport" : "element";
  const src = mode === "element" ? snap?.element : snap?.viewport;
  const label = viewportLabel(entry.viewport);
  // Natural width of the loaded image, to cap upscaling at 2x like the prototype.
  const [natural, setNatural] = useState<{ src: string; w: number } | null>(null);
  const loaded = !!src && natural?.src === src;

  if (!src) {
    return (
      <div className="shot snap" role="img" aria-label="Snapshot of the page where this was filed" style={{ height: 150 }}>
        <div className="snap-empty">
          <Icon name={entry.viewport} />
          <span>Captured on {label.toLowerCase()}. Switch to that size to preview it here.</span>
          <Button size="sm" onClick={onShow}>
            <Icon name="eye" size="s" />
            Show on {label.toLowerCase()}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shot snap">
      <img
        key={src}
        className={cx(loaded && "ld")}
        src={src}
        alt="Snapshot of the page where this was filed"
        style={{ maxWidth: natural && natural.src === src ? natural.w * 2 : undefined }}
        onLoad={(e) => setNatural({ src, w: e.currentTarget.naturalWidth })}
      />
      {hasElement && hasViewport ? (
        <div className="mode" role="group" aria-label="Snapshot view">
          <button type="button" className={cx(mode === "element" && "on")} aria-pressed={mode === "element"} onClick={() => setPicked("element")}>
            Element
          </button>
          <button type="button" className={cx(mode === "viewport" && "on")} aria-pressed={mode === "viewport"} onClick={() => setPicked("viewport")}>
            Viewport
          </button>
        </div>
      ) : null}
      <div className="cap">
        <Chip icon={<Icon name={entry.viewport} size="xs" />}>
          <span className="num">{sizeLabel(entry)}</span>
        </Chip>
        <Chip mono>{snapshotFile(entry, mode)}</Chip>
      </div>
    </div>
  );
}
