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

  // The rail campaign list is live AgentListItem rows, ordered
  // live → paused → draft (owner ruling, B1 review).
  const rail = page.getByTestId("bold-camps-list");
  await expect(rail.getByText("Implant open day")).toBeVisible();
  await expect(rail.getByText("Whitening kit push")).toBeVisible();
  await expect(rail.getByText("Review asks")).toBeVisible();
  const firstRow = rail.locator(".cvb-camp-row").first();
  await expect(firstRow).not.toContainText("Review asks");
  await expect(firstRow).not.toContainText("New-Patient");

  // Selecting the seeded campaign lands on its overview with the tab frame.
  await rail.getByText("Implant open day").click();
  await expect(page.getByTestId("bold-page-title")).toHaveText("Implant open day");
  for (const tab of ["overview", "pipeline", "plan", "inbox", "stats", "settings"]) {
    await expect(page.getByTestId(`bold-tab-${tab}`)).toBeVisible();
  }

  // Hero: count leads for booking goals; POTENTIAL is money already in
  // motion — completions × est (owner ruling, B1 review), never the goal
  // ceiling, which shows only as % OF GOAL + "11 of 12 to go".
  await expect(page.getByTestId("bold-hero-value")).toHaveText("1");
  await expect(page.getByText("$2,400 potential at $2,400 a booking")).toBeVisible();
  await expect(page.getByText("11 of 12 to go.")).toBeVisible();
  const statsRow = page.getByTestId("bold-stats-row");
  await expect(statsRow).toContainText("POTENTIAL");
  await expect(statsRow).toContainText("1 × $2,400");
  await expect(statsRow).toContainText("REPLY RATE");
  // F1 honesty floor: under 20 sends the rate is honest-absent, never
  // invented; console replies (B3b) accumulate real sends, so past the floor
  // a REAL percentage renders — assert whichever the live count earns.
  await expect(statsRow.getByText(/needs 20 sends|\d+(\.\d+)?%/).first()).toBeVisible();

  // Drawer kind 1 — the stat drill (num): opens and RENDERS content (this
  // suite must fail if a drawer dies client-side).
  await statsRow.getByText("POTENTIAL", { exact: true }).click();
  const numDrawer = page.getByTestId("bold-drawer");
  await expect(numDrawer).toBeVisible();
  await expect(numDrawer).toContainText("POTENTIAL VALUE");
  await expect(numDrawer).toContainText("HOW IT SPLITS");
  await expect(numDrawer).toContainText("Booked (1)");
  await expect(numDrawer).toContainText("To go (11)");
  await page.mouse.click(400, 300);
  await expect(numDrawer).toHaveCount(0);

  // The feed is HAPPENING NOW — newest N, whatever they are (live activity
  // accumulates across runs, so a fixed seeded row cannot be pinned here).
  // The seeded won/goal facts stay durably reachable through the activity
  // page's kind filters — the deterministic claim.
  await expect(page.getByTestId("bold-feed")).toBeVisible();
  await page.getByTestId("bold-all-activity").click();
  await expect(page.getByTestId("bold-activity-page")).toBeVisible();
  await page.getByTestId("bold-act-filter-won").click();
  await expect(page.getByTestId("bold-activity-page").getByText(/Payment received/).first()).toBeVisible();
  await page.getByTestId("bold-act-filter-goal").click();
  await expect(page.getByTestId("bold-activity-page").getByText(/Meeting booked/).first()).toBeVisible();
});

test("the activity page filters; send rows drill to recipients; contact rows open the person peek", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByTestId("bold-all-activity").click();
  await expect(page.getByTestId("bold-activity-page")).toBeVisible();

  // Drawer kind 2 — the sent-to-N recipients subset (grp).
  await page.getByTestId("bold-act-filter-send").click();
  // B3b: console replies aggregate into their own ad-hoc send group, so
  // more than one "Sent to N" row can match — the SEEDED step row is the
  // oldest match (rows order newest-first).
  const sendRow = page.getByTestId("bold-activity-page").getByText(/Sent to 3/).last();
  await expect(sendRow).toBeVisible();
  await sendRow.click();
  const drawer = page.getByTestId("bold-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Ada Lovelace")).toBeVisible();
  await expect(drawer.getByText("Replied", { exact: true }).first()).toBeVisible();
  await page.mouse.click(400, 300);
  await expect(drawer).toHaveCount(0);

  // Drawer kind 3 — the person peek: it must RENDER the shipped timeline
  // read, not die client-side (the review blocker: the timeline endpoint
  // returns { events } and the drawer crashed on the unwrapped shape).
  // Filter to goal rows first — the seeded row stays on page one there,
  // whatever live activity has accumulated above it.
  await page.getByTestId("bold-act-filter-goal").click();
  await page.getByTestId("bold-activity-page").getByText(/Meeting booked/).first().click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Ada Lovelace");
  await expect(drawer).toContainText("TIMELINE");
  await expect(drawer).toContainText("Payment received.");
  await page.mouse.click(400, 300);
  await expect(drawer).toHaveCount(0);
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
  // (.first(): a persistent deployment can hold MORE than one goal-met
  // campaign — the pill's presence is the claim, not its count.)
  await expect(page.getByTestId("bold-camps-page").getByText("✓ GOAL MET").first()).toBeVisible();

  // The cross-workspace needs pill reads real data (one reply waits in demo-2).
  await expect(page.getByTestId("bold-ws-needs")).toHaveText("1 elsewhere");
});
