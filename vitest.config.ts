import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Matches tsconfig.json's "@/*": ["src/*"] — kept as a plain Vite alias (not a plugin like
    // vite-tsconfig-paths) since there's only the one mapping to keep in sync.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Makes describe/it/expect global, so test files don't need to import them.
    globals: true,
  },
});
