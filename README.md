# Proompter

A review layer you turn on over your own app. Pick any element on any viewport, write what's wrong,
and get a markdown file in your repo with the source location, console, network and a snapshot.

> Status: v1 in progress. See [DESIGN.md](DESIGN.md) and [tasks/](tasks/).

## Install

```sh
pnpm add -D @rachitkay/proompter
```

Entries: `@rachitkay/proompter` (client), `@rachitkay/proompter/next` (Next config). Reserved:
`/next/route`, `/github` (v2).

## Develop

```sh
pnpm i
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm storybook   # UI kit
pnpm e2e         # Playwright; starts the playground itself
```

MIT
