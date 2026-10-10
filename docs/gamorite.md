# Gamorite plugin sketch: route → task

Gamorite's plugin lives in Gamorite's own repo. Nothing Gamorite-specific goes into `@rachitkay/proompter`.
This note sketches it. It doesn't change the Gamorite repo.

## Goal

When a reviewer files an entry on `/feeds`, the entry's frontmatter gets `task: T-feed-home` and the Task
chip in the composer shows it. The agent that later reads `reviews/.../entries/005-*.md` knows which
migration task owns that page.

## Source of truth

Each task file in Gamorite's `migration/_tasks/T-*.md` declares the routes it covers in its frontmatter:

```yaml
---
id: T-feed-home
title: Feed and posts
routes:
  - /feeds
  - /feeds/[postId]
---
```

## Plugin

```ts
// gamorite: src/dev/proompter-tasks.ts
import type { ProompterPlugin } from "@rachitkay/proompter";
import tasks from "./tasks.generated.json"; // [{ id: "T-feed-home", routes: ["/feeds", "/feeds/[postId]"] }]

/** "/feeds/[postId]" → /^\/feeds\/[^/]+$/ */
const matcher = (route: string) =>
  new RegExp(`^${route.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+")}/?$`);

const compiled = tasks.flatMap((t) => t.routes.map((r) => ({ id: t.id, re: matcher(r) })));

export function gamoriteTasks(): ProompterPlugin {
  return {
    name: "gamorite-tasks",
    taskFor: ({ route }) => compiled.find((c) => c.re.test(route))?.id ?? null,
    testPlan: ["§1 Auth", "§2 Feed and posts", "§3 Tournaments"],
  };
}
```

```tsx
// gamorite: app/layout.tsx
<Proompter plugins={[gamoriteTasks()]} session={{ reviewer: "rachit" }} />
```

`taskFor` gets the route the entry was filed on, and optionally the entry's `source` (so a shared component
can be matched by file instead). Returning `null` omits `task:` from the entry.

## Generating `tasks.generated.json`

A small script (run in Gamorite's `predev`, or by hand) reads the frontmatter of every
`migration/_tasks/T-*.md` and writes `{ id, routes }` for each task. Keeping the lookup in a generated file
means the browser bundle never parses markdown. A task without `routes:` is skipped.

## Open questions

- Several tasks claiming one route: first match wins today. A later plugin version could return a list.
- Dynamic segments: the matcher above treats `[x]` as one segment and `[...x]` as the rest of the path.
- Redaction: if the plugin adds `context()` fields, keep them free of user data. `redact` runs on top.
