import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false, // all tests share one embedded Postgres
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
