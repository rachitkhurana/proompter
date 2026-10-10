import { describe, expect, it } from "vitest";
import { globToRegExp } from "../core/glob";
import { repoPlugin } from "./repo";

const task = (p: ReturnType<typeof repoPlugin>, route: string) => p.taskFor?.({ route });

describe("repoPlugin taskFor", () => {
  const p = repoPlugin({
    tasks: {
      "/clips/new": "tasks/T-new.md",
      "/clips/**": "tasks/T-clips.md",
      "/a?": "tasks/T-q.md",
      "/{x,y}/*": "tasks/T-alt.md",
      "/": "tasks/T-home.md",
    },
  });
  it("matches ** across segments", () => {
    expect(task(p, "/clips/1/edit")).toBe("tasks/T-clips.md");
    expect(task(p, "/clips/1")).toBe("tasks/T-clips.md");
  });
  it("first match wins (insertion order)", () => {
    expect(task(p, "/clips/new")).toBe("tasks/T-new.md");
  });
  it("supports ?, {a,b} and *", () => {
    expect(task(p, "/ab")).toBe("tasks/T-q.md");
    expect(task(p, "/y/z")).toBe("tasks/T-alt.md");
    expect(task(p, "/y/z/w")).toBeNull();
  });
  it("matches the pathname only", () => {
    expect(task(p, "/clips/1?tab=2#x")).toBe("tasks/T-clips.md");
    expect(task(p, "/other?next=/clips/1")).toBeNull();
  });
  it("returns null with no match, and has no taskFor with no tasks", () => {
    expect(task(p, "/nope")).toBeNull();
    expect(repoPlugin().taskFor).toBeUndefined();
  });
  it("matches trailing names", () => {
    const q = repoPlugin({ tasks: { "/docs/intro": "t.md" } });
    expect(task(q, "/docs/intro")).toBe("t.md");
    expect(task(q, "/docs/introx")).toBeNull();
  });
});

describe("repoPlugin passthrough", () => {
  it("defaults the name and passes testPlan", () => {
    const p = repoPlugin({ testPlan: ["Smoke", "Auth"] });
    expect(p.name).toBe("repo");
    expect(p.testPlan).toEqual(["Smoke", "Auth"]);
    expect(repoPlugin({ name: "x" }).name).toBe("x");
  });
  it("passes context through and swallows a throw", () => {
    expect(repoPlugin({ context: () => ({ a: 1 }) }).context?.()).toEqual({ a: 1 });
    expect(
      repoPlugin({
        context: () => {
          throw new Error("boom");
        },
      }).context?.(),
    ).toEqual({});
  });
});

describe("core/glob", () => {
  it("is the same function the loader re-exports", async () => {
    const loader = await import("../next/loader");
    expect(loader.globToRegExp).toBe(globToRegExp);
  });
});
