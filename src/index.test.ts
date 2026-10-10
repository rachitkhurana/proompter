import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as entry from "./index";
import { Proompter } from "./index";
import styles from "./ui/styles.css?inline";

describe("smoke", () => {
  it("exports the Proompter component, which renders nothing on the server", () => {
    expect(typeof Proompter).toBe("function");
    expect(renderToString(createElement(Proompter, {}))).toBe("");
  });

  it("compiles the UI stylesheet to a string (it is only imported by the lazy UI chunk)", () => {
    expect(typeof styles).toBe("string");
    expect(styles).toContain("pm-root");
  });

  it("keeps the stylesheet out of the entry's exports", () => {
    expect(Object.keys(entry)).toEqual(["Proompter"]);
  });
});
