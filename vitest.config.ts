import { defineConfig } from "vitest/config";

// Test config. Separate from vite.config.ts because the build config
// externalizes React (it's a peer dep in the shipped bundle) — but tests
// need React to actually resolve at run time.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Tests live next to source so coverage + imports stay simple.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
