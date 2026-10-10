import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

// `proompter()` always defines VITE_PROOMPTER, so with the flag off this is `"" === "true"` at build time and the
// dynamic import is dropped from the bundle.
const Kit =
  import.meta.env.VITE_PROOMPTER === "true"
    ? lazy(() => import("@rachitkay/proompter").then((m) => ({ default: m.Proompter })))
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {Kit && (
      <Suspense fallback={null}>
        <Kit session={{ reviewer: "vite" }} />
      </Suspense>
    )}
  </StrictMode>,
);
