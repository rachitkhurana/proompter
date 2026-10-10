// Dev-only file writer (DESIGN 3). URL: /api/proompter. It answers 404 unless NODE_ENV=development and the
// flag is on; the client's `endpoint` is configurable if you mount it somewhere else.
export { GET, POST } from "@rachitkay/proompter/next/route";
