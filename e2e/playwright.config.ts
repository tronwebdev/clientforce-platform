import { defineConfig, devices } from "@playwright/test";

/**
 * E2E target. CI sets E2E_BASE_URL to the deployed staging web FQDN
 * (https://clientforce-web.…azurecontainerapps.io); locally it defaults to a
 * two-server dev stack on :3000.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Optional: point Chromium at a pre-provisioned browser (e.g. the sandbox's
// /opt/pw-browsers) instead of a `playwright install` download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Staging cold-starts can make the first hit flaky; a couple of retries keeps
  // the gate honest without masking real failures.
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
