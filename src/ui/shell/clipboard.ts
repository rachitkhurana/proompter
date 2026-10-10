import { toast } from "../primitives/toast";

/**
 * Copy `text` and toast `ok`. Falls back to a throwaway textarea (inside the shadow container, so the host
 * document is never touched), and says so when the browser blocks copying.
 */
export async function copyText(text: string, ok: string, container?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
    return true;
  } catch {
    const parent = container ?? document.body;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    parent.appendChild(ta);
    ta.select();
    const done = (() => {
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    })();
    ta.remove();
    toast(done ? ok : "Copying is blocked here. Open the file view and select the text instead.");
    return done;
  }
}
