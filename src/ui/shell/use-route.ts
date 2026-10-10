import { useEffect, useState } from "react";
import type { PickSurface } from "../../core/surface";

const read = (s: PickSurface | null): string | undefined => {
  try {
    return s ? s.win.location.pathname : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The path shown on the surface (`/feeds`), so pins filed on other routes stay hidden. Follows SPA navigation
 * (history API calls raise no event), by checking on `popstate` and on a slow interval while the kit is open.
 */
export function useRoute(surface: PickSurface | null): string | undefined {
  const [route, setRoute] = useState(() => read(surface));
  useEffect(() => {
    const check = () => setRoute(read(surface));
    check();
    if (!surface) return;
    const win = surface.win;
    win.addEventListener("popstate", check);
    const id = window.setInterval(check, 400);
    return () => {
      win.removeEventListener("popstate", check);
      window.clearInterval(id);
    };
  }, [surface]);
  return route;
}
