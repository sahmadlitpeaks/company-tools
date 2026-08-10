import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Point PLAYWRIGHT_BASE_URL at a running stack
 * (e.g. `docker compose up`, default http://localhost:8080) and run:
 *
 *   npx playwright install   # one-time: download browsers
 *   npm run test:e2e
 *
 * E2E_EMAIL and E2E_PASSWORD must identify an active local account.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
