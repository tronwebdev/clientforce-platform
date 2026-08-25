import { test, expect, type Page } from "@playwright/test";

/**
 * B1 smoke — the campaign console goes live behind `consoleBold`.
 *
 * Runs where the flag is on (seeded demo workspace); skips with an annotation
 * elsewhere, same posture as the B0 spec. Asserts against the B1 seed
 * fixtures (packages/db/prisma/seed.ts): the "Implant open day" campaign with
 * value est $2,400 × target 12, one booked contact (Ada Lovelace), three
 * step sends, and one payment receipt.
 */

const OWNER_EMAIL = "owner@demo-agency.test";

async function signInToBold(page: Page): Promise<boolean> {
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

test("rail lists live campaigns; the overview hero reads the value model", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  // The rail campaign list is live AgentListItem rows, not fixture.
  const rail = page.getByTestId("bold-camps-list");
  await expect(rail.getByText("Implant open day")).toBeVisible();
  await expect(rail.getByText("Whitening kit push")).toBeVisible();
  await expect(rail.getByText("Review asks")).toBeVisible();

  // Selecting the seeded campaign lands on its overview with the tab frame.
  await rail.getByText("Implant open day").click();
  await expect(page.getByTestId("bold-page-title")).toHaveText("Implant open day");
  for (const tab of ["overview", "pipeline", "plan", "inbox", "stats", "settings"]) {
    await expect(page.getByTestId(`bold-tab-${tab}`)).toBeVisible();
  }

  // Hero: count leads for booking goals; the money expression rides the sub
  // line (1 booked × $2,400, target 12 → $28.8k potential).
  await expect(page.getByTestId("bold-hero-value")).toHaveText("1");
  await expect(page.getByText("$28.8k potential at $2,400 a booking")).toBeVisible();
  await expect(page.getByTestId("bold-stats-row")).toContainText("POTENTIAL");
  await expect(page.getByTestId("bold-stats-row")).toContainText("REPLY RATE");
  // F1 honesty floor: 3 sends < 20 → the rate is honest-absent, never invented.
  await expect(page.getByTestId("bold-stats-row")).toContainText("needs 20 sends");

  // The latest goal/won event rides the HAPPENING NOW card (deduped from the
  // feed below it); the feed carries the rest of the seeded activity.
  await expect(page.getByText(/Payment received/).first()).toBeVisible();
  await expect(page.getByTestId("bold-feed").getByText(/Meeting booked/).first()).toBeVisible();
});

test("the activity page filters, and a send row drills into its recipients", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByTestId("bold-all-activity").click();
  await expect(page.getByTestId("bold-activity-page")).toBeVisible();

  // Filter to sends, open the aggregated row, land in the sorted subset.
  await page.getByTestId("bold-act-filter-send").click();
  const sendRow = page.getByTestId("bold-activity-page").getByText(/Sent to 3/);
  await expect(sendRow).toBeVisible();
  await sendRow.click();
  const drawer = page.getByTestId("bold-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Ada Lovelace")).toBeVisible();
  await expect(drawer.getByText("Replied", { exact: true }).first()).toBeVisible();
});

test("the all-campaigns page shows live rows with goal state", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByText("All", { exact: true }).click();
  await expect(page.getByTestId("bold-camps-page")).toBeVisible();
  await expect(page.getByTestId("bold-camps-page").getByText("Implant open day")).toBeVisible();
  // The goal-met pill rides the campaign that reached its terminal stage.
  await expect(page.getByTestId("bold-camps-page").getByText("✓ GOAL MET")).toBeVisible();

  // The cross-workspace needs pill reads real data (one reply waits in demo-2).
  await expect(page.getByTestId("bold-ws-needs")).toHaveText("1 elsewhere");
});
