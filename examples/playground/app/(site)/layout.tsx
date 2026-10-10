import type { ReactNode } from "react";
import "../../components/host.css";

// The import sits in a branch the bundler can prove dead: with the flag unset, `process.env.NEXT_PUBLIC_*`
// is a build-time constant, the branch is removed before the module graph is built, and nothing from
// Proompter reaches the bundle (DESIGN 1.1). A static `import { Proompter }` plus `{flag && <Proompter />}`
// does NOT guarantee that: the client reference (and its chunk) stays.
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const Kit =
    process.env.NEXT_PUBLIC_PROOMPTER === "true" ? (await import("@rachitkay/proompter")).Proompter : null;
  return (
    <>
      {children}
      {Kit && <Kit session={{ reviewer: "playground" }} />}
    </>
  );
}
