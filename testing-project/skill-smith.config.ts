// Projects would import from 'skill-smith' in a real project.
import { defineConfig } from "../src";

export default defineConfig({
  models: {
    agentUnderTest: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ],
    judge: "claude-opus-4-7",
  },
});
