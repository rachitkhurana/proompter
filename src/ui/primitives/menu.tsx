import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { CheckMarkIcon } from "../icons";
import { useShadowContainer } from "../shadow-root";

const bodyGuards = () => Array.from(document.body.children).filter((c) => c.hasAttribute("data-radix-focus-guard"));

function enabledItems(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])'));
}

export interface MenuItem {
  /** Stable id, passed to `onSelect`. */
  key: string;
  label: string;
  icon?: ReactNode;
  /** Right-aligned hint, usually a `<Kbd>`. Not shown for checked items (they show the check). */
  shortcut?: ReactNode;
  /** Selected state, for `selection="single"` and `"multiple"`. */
  checked?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  /** The element that opens the menu (a button or `<Chip as="button">`). It must forward its ref. */
  trigger: ReactElement;
  items: ReadonlyArray<MenuItem>;
  /** Small heading above the items. */
  header?: ReactNode;
  /**
   * `none`: plain actions, the menu closes on select.
   * `single`: one checked item (radio), the menu closes on select.
   * `multiple`: any number checked (tags), the menu stays open on select.
   */
  selection?: "none" | "single" | "multiple";
  onSelect: (key: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Accessible name of the menu. Falls back to the trigger's. */
  label?: string;
}

/**
 * Dropdown menu on `@radix-ui/react-dropdown-menu`, restyled to the prototype. Arrow keys move
 * (looping), type-ahead jumps, Enter/Space selects, Esc closes and returns focus to the trigger.
 * It scales in from the trigger (Radix exposes the transform origin) and portals into the shadow root.
 * Non-modal, so the host page keeps working (no scroll lock, no `pointer-events` on `body`).
 */
export function Menu({
  trigger,
  items,
  header,
  selection = "none",
  onSelect,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
  label,
}: MenuProps) {
  const container = useShadowContainer();
  const contentRef = useRef<HTMLDivElement>(null);

  // Radix's MenuContent calls `useFocusGuards()` unconditionally, which appends two
  // `<span data-radix-focus-guard tabindex="0">` to the HOST `document.body` (there is no prop to turn it off,
  // and it ignores `container`). Non-modal menus have no use for them, and the kit must leave the host document
  // untouched (DESIGN §1.2), so remove the ones this menu caused. If the host already had guards (its own
  // Radix dialog), they are left alone.
  const [isOpenState, setIsOpen] = useState(!!defaultOpen);
  const isOpen = open ?? isOpenState;
  const hadGuards = useRef(false);
  useLayoutEffect(() => {
    // Layout effects run before any passive effect of the commit, so before Radix inserts the guards.
    if (isOpen) hadGuards.current = bodyGuards().length > 0;
  }, [isOpen]);
  useEffect(() => {
    // Runs after the content's own effects (this component is its ancestor).
    if (!isOpen || hadGuards.current) return;
    bodyGuards().forEach((g) => g.remove());
  }, [isOpen]);
  const checkedKey = items.find((i) => i.checked)?.key ?? "";

  const renderBody = (item: MenuItem) => (
    <>
      {item.icon}
      <span>{item.label}</span>
      {selection === "none" ? (
        item.shortcut
      ) : (
        <DropdownMenu.ItemIndicator className="ck">
          <CheckMarkIcon size="s" />
        </DropdownMenu.ItemIndicator>
      )}
    </>
  );

  const list = items.map((item) => {
    if (selection === "multiple") {
      return (
        <DropdownMenu.CheckboxItem
          key={item.key}
          className="mi"
          checked={!!item.checked}
          disabled={item.disabled}
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open for multi-select
            onSelect(item.key);
          }}
        >
          {renderBody(item)}
        </DropdownMenu.CheckboxItem>
      );
    }
    if (selection === "single") {
      return (
        <DropdownMenu.RadioItem
          key={item.key}
          className="mi"
          value={item.key}
          disabled={item.disabled}
          onSelect={() => onSelect(item.key)}
        >
          {renderBody(item)}
        </DropdownMenu.RadioItem>
      );
    }
    return (
      <DropdownMenu.Item
        key={item.key}
        className="mi"
        disabled={item.disabled}
        onSelect={() => onSelect(item.key)}
      >
        {renderBody(item)}
      </DropdownMenu.Item>
    );
  });

  return (
    <DropdownMenu.Root
      modal={false}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(o) => {
        setIsOpen(o);
        onOpenChange?.(o);
      }}
    >
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className="menu"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          loop
          aria-label={label}
          // Radix's roving focus compares `document.activeElement` before and after `focus()`. Inside a
          // shadow root that is always the host, so it keeps going and lands on the LAST item. We move
          // focus ourselves: initial focus here, arrows/Home/End below.
          // (`onOpenAutoFocus` exists at runtime but DropdownMenu.Content's types omit it.)
          {...{
            onOpenAutoFocus: (e: Event) => {
              e.preventDefault();
              const el = contentRef.current;
              el?.focus({ preventScroll: true });
              // Prototype: item 0 is focused and highlighted however the menu was opened.
              if (el) enabledItems(el)[0]?.focus({ preventScroll: true });
            },
          }}
          ref={contentRef}
          onKeyDownCapture={(e: KeyboardEvent<HTMLDivElement>) => {
            const { key } = e;
            if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
            const list = enabledItems(e.currentTarget);
            if (list.length === 0) return;
            e.preventDefault();
            e.stopPropagation();
            const active = (e.currentTarget.getRootNode() as Document | ShadowRoot).activeElement;
            const i = list.findIndex((el) => el === active);
            const n = list.length;
            const next =
              key === "Home"
                ? 0
                : key === "End"
                  ? n - 1
                  : key === "ArrowDown"
                    ? i < 0
                      ? 0
                      : (i + 1) % n
                    : i < 0
                      ? n - 1
                      : (i - 1 + n) % n;
            list[next]?.focus({ preventScroll: true });
          }}
        >
          {header ? <DropdownMenu.Label className="mh">{header}</DropdownMenu.Label> : null}
          {selection === "single" ? (
            <DropdownMenu.RadioGroup value={checkedKey}>{list}</DropdownMenu.RadioGroup>
          ) : (
            list
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
