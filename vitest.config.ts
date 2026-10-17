import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: { HALLUCHECK_OFFLINE: "1", HALLUCHECK_EXTERNAL_INFERENCE: "0" },
    testTimeout: 10000,
  },
});
