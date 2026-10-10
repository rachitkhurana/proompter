import { describe, expect, it } from "vitest";
import { __styles, Proompter } from "./index";

describe("smoke", () => {
  it("exports the Proompter component stub", () => {
    expect(typeof Proompter).toBe("function");
    expect(Proompter({})).toBeNull();
  });

  it("inlines the compiled stylesheet as a string", () => {
    expect(typeof __styles).toBe("string");
    expect(__styles).toContain("pm-root");
  });
});
