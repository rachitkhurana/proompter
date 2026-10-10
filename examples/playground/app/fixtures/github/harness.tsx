"use client";

import { Proompter } from "@rachitkay/proompter";

/** The real kit (real store, real files sink) with GitHub sync on. */
export function GithubHarness() {
  return <Proompter session={{ reviewer: "e2e", title: "GitHub sync" }} github={{ endpoint: "/api/proompter/github" }} />;
}
