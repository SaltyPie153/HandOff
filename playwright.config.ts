import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120000,
  workers: 1,
  globalTimeout: 480000,
  globalSetup: "./tests/e2e/fixtures/environment.ts",
  use: { baseURL: "http://127.0.0.1:5174", browserName: "chromium" },
  reporter: "list"
});
