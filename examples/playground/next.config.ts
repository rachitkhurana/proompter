import type { NextConfig } from "next";
import { withProompter } from "@rachitkay/proompter/next";

const enabled = process.env.NEXT_PUBLIC_PROOMPTER === "true";

const nextConfig: NextConfig = {
  // The e2e production check (DESIGN 11.1) builds into its own folder, so it never fights the dev server.
  distDir: process.env.PLAYGROUND_DIST_DIR || ".next",
};

export default withProompter(nextConfig, { enabled });
