import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: "./vitest.globalSetup.ts",
    testTimeout: 10000,
    hookTimeout: 30000,
    env: {
      WEBHOOK_SECRET: "test-webhook-secret-at-least-32-chars-long",
    },
    execArgv: ["--no-warnings"],
  },
})
