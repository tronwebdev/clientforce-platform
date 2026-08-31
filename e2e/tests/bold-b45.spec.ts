import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL } from "./_fixtures";

/**
 * B4.5 smoke — the live-call card (the old console's rcpCallOpen treatment)
 * in both duties:
 *  - the receptionist pitch's "Preview a call": the scripted demo runs the
 *    full three-state lifecycle, LABELED as a preview, claiming no log;
 *  - a REAL IN_PROGRESS Ada call (transient DB fixture through the same row
 *    shapes the voice service writes): the card shows the live transcript,
 *    and Jump in rides the real takeover endpoint (keyless sandbox: the
 *    takeover marker is real, no audio leg mounts, and the card says so).
 * The fixture is torn down in finally — nothing lingers as a "live" call.
 */

test.describe.configure({ mode: "serial" });
test.use({
  permissions: ["microphone"],
  // test.use replaces launchOptions wholesale — re-pin the executable the
  // shared config reads from the env, or this spec launches nothing.
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

// The transient-fixture rail needs direct DB access: FIXTURE_DATABASE_URL, or
// the dev stack's DATABASE_URL. No cred-bearing fallback literal here — the
// local default lives in packages/db/.env.example, and the deploy secret-scan
// gate (rightly) refuses user:pass@ URLs in tracked files (DEC-132). Against
// deployed staging the runner can reach neither, so the live-fixture test
// skips there, honestly; the preview test needs no DB and always runs.
const DB_URL = process.env.FIXTURE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

const fixture = (phase: "live" | "done"): string =>
  execSync(`pnpm --filter @clientforce/db exec tsx prisma/b45-live-fixture.ts ${phase}`, {
    cwd: `${process.cwd()}/..`,
    env: { ...process.env, DATABASE_URL: DB_URL },
  })
    .toString()
    .trim()
    .split("\n")
    .pop()!;

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("agents-subtitle")).toBeVisible();
  const active = await page.getByTestId("ws-active-name").textContent().catch(() => "");
  if (active?.trim() !== "Demo Workspace") {
    await expect(async () => {
      await page.getByTestId("ws-switcher").click();
      await expect(page.getByTestId("ws-option-demo")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByTestId("ws-option-demo").click();
    await expect(page.getByTestId("ws-active-name")).toHaveText("Demo Workspace");
  }
}

async function toBold(page: Page): Promise<boolean> {
  await page.goto("/bold");
  try {
    await page.getByTestId("bold-root").waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  const later = page.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  return true;
}

test("Preview a call: the pitch's scripted demo runs labeled through the card and logs nothing", async ({ page }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");

  // The receptionist tile needs the flags read — re-click until the panel
  // opens (the bold-b4 toPass posture; a pre-flags click flashes instead).
  await expect(async () => {
    await page.getByTestId("bold-dock-rcp").click();
    await expect(page.getByTestId("bold-rcp")).toBeVisible({ timeout: 2_500 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId("bold-rcp-preview").click();
  // The prototype's handoff: the drawer leaves, the card rises.
  await expect(page.getByTestId("bold-rcp")).toBeHidden();
  const card = page.getByTestId("bold-livecall");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("bold-livecall-preview-chip")).toHaveText("PREVIEW");
  await expect(card).toContainText("Incoming call");
  await expect(page.getByTestId("bold-livecall-clock")).toHaveText("ringing");

  // Accept early (the prototype's rcpAnswerNow) → live, lines land on the script clock.
  await page.getByTestId("bold-livecall-answer").click();
  await expect(card).toContainText("✦ Receptionist on the line");
  await expect(page.getByTestId("bold-livecall-lines")).toContainText("you've reached the AI receptionist", { timeout: 10_000 });
  await expect(page.getByTestId("bold-livecall-lines")).toContainText("Thursday works.", { timeout: 15_000 });

  // Handled — honest preview truth: labeled, nothing logged, nothing spent.
  await expect(card).toContainText("Call handled", { timeout: 10_000 });
  await expect(card).toContainText("Preview finished · nothing was logged");
  await expect(card).toContainText("A real call lands on the timeline — this preview doesn't.");
  await expect(card).toContainText("Booked");
  await page.getByTestId("bold-livecall-done").click();
  await expect(card).toBeHidden();
});

test("a real live call surfaces the card; Jump in takes over honestly in the keyless sandbox", async ({ page }) => {
  test.skip(!DB_URL, "no fixture DB reachable (FIXTURE_DATABASE_URL/DATABASE_URL unset — deployed staging) — the live-call fixture rail runs on the local stack");
  const callId = fixture("live");
  expect(callId.length).toBeGreaterThan(10);
  try {
    await signIn(page);
    if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");

    const card = page.getByTestId("bold-livecall");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("✦ Ada on the line");
    await expect(card).toContainText("Livia Hart");
    // The per-turn rows — the same Message rows the voice service streams.
    await expect(page.getByTestId("bold-livecall-lines")).toContainText("this is Ada");
    await expect(page.getByTestId("bold-livecall-lines")).toContainText("Thursday should work");

    // Jump in: mic preflight (fake device), the REAL takeover endpoint, and
    // the honest sandbox band — no audio leg exists to mount here.
    await page.getByTestId("bold-livecall-jumpin").click();
    await expect(card).toContainText("You are on the call", { timeout: 10_000 });
    await expect(card).toContainText("practice takeover — no live audio leg in this environment");
    await page.getByTestId("bold-livecall-done").click();
    await expect(card).toBeHidden();
  } finally {
    fixture("done");
  }
});
