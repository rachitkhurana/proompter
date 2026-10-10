// GitHub sync (DESIGN D16). URL: /api/proompter/github. It answers 404 until PROOMPTER_GITHUB_TOKEN (a fine-grained
// PAT with Contents and Issues read/write on the repo) and PROOMPTER_REVIEW_KEY are set. The e2e points `api` at a
// fake GitHub (PROOMPTER_GITHUB_API); leave it unset to talk to api.github.com.
import { createGithubRoute } from "@rachitkay/proompter/github";

const route = createGithubRoute({
  repo: process.env.PROOMPTER_GITHUB_REPO ?? "owner/name",
  ...(process.env.PROOMPTER_GITHUB_API ? { api: process.env.PROOMPTER_GITHUB_API } : {}),
});
export const GET = route.GET;
export const POST = route.POST;
