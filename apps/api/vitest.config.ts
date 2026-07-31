import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests share one DB — run serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
