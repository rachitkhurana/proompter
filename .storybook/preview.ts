import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { StoryFrame } from "../src/ui/primitives/story-frame";

const preview: Preview = {
  parameters: {
    layout: "centered",
    // addon-a11y: axe violations fail the story (surfaced as errors in the a11y panel and test runs).
    a11y: { test: "error" },
  },
  // Every story renders inside a real shadow root, with the production CSS.
  decorators: [(Story) => createElement(StoryFrame, null, createElement(Story))],
};

export default preview;
