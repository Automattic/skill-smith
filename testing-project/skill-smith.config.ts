// Projects would import from 'skill-smith' in a real project.
import { defineConfig } from "../src";

export default defineConfig({
  agents: {
    testing: {
      haiku: "claude-haiku-4-5-20251001",
      sonnet: "claude-sonnet-4-6",
      opus: "claude-opus-4-7",
    },
    judge: {
      opus: { model: "claude-opus-4-7", effort: "xhigh" },
    },
  },
});
