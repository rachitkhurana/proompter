import { useState } from "react";
import { Proompter } from "../proompter";
import { createFakeDeps } from "./fake";

/**
 * Test-only harness, exported through `@rachitkay/proompter/internal/fixtures` (see src/internal/fixtures.ts).
 * The full `<Proompter>`, open from the start, over the e2e route's page, with the in-memory store, the
 * prototype's four seeded entries and a bare composer. Not public API.
 */
export function KitHarness() {
  const [deps] = useState(() => createFakeDeps({ route: "/fixtures/kit", written: false }));
  return <Proompter defaultOpen deps={deps} session={{ reviewer: "rachit" }} plugins={PLUGINS} />;
}

const PLUGINS = [{ name: "fixture", testPlan: ["§2 Feed and posts", "§7 Voice"] }];
