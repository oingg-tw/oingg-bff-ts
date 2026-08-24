import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Makes describe/it/expect global, so test files don't need to import them.
    globals: true,
  },
});
