import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import { existsSync } from "node:fs";

// AI : Load test environment variables
dotenv.config({ path: ".env" });

/**
 * AI : Playwright configuration for Urbanist Map testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* Global setup for authentication */
  globalSetup: "./tests/global-setup.ts",
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Reduce timeout because 30s is way too much */
  timeout: 15 * 1000,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: Boolean(process.env.CI),
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use single worker to avoid conflicts */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["html", "list"],
    ["json", { outputFile: "test-results.json" }],
  ],
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:5173",
    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",
    /* Take screenshot on failure */
    screenshot: "only-on-failure",
    /* Record video on failure */
    video: "on",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /* Use authenticated state if available */
        ...(existsSync("tests/auth-state.json") ? { storageState: "tests/auth-state.json" } : {}),
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "bun run dev-front",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 5 * 1000,
  },
});
