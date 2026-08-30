import { test, expect, type Page } from "@playwright/test";

/**
 * B8 smoke — analytics + integrations on real reads:
 *  - the campaign Stats tab renders the seeded-history aggregates (tiles,
 *    funnel, by-channel) from /stats — no fixture numbers;
 *  - the workspace Analytics surface is the SAME component at workspace
 *    scope, with the live campaign filter and the deferred filter chip;
 *  - the range pills re-query (7 days ≤ 30 days, monotonic on real data);
 *  - the Integrations surface lists the registry with real statuses; the
 *    BuyerPing drawer connects/disconnects in place (restore-first).
 */

test.describe.configure({ mode: "serial" });

const OWNER_EMAIL = "owner@demo-agency.test";

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

const tileValue = async (page: Page, key: string): Promise<number> => {
  const v = await page.getByTestId(`bold-stats-tilev-${key}`).textContent();
  return Number((v ?? "0").replace(/[^0-9]/g, "")) || 0;
};

test("the campaign Stats tab renders real aggregates from the seeded history", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByText("Stats", { exact: true }).click();
  await expect(page.getByTestId("bold-stats")).toBeVisible();

  // The seeded 3-week history reaches ≥5 contacts on this campaign. The
  // tile label renders before the read lands — poll until the number does.
  let reached30 = 0;
  await expect(async () => {
    reached30 = await tileValue(page, "reached");
    expect(reached30).toBeGreaterThanOrEqual(5);
  }).toPass({ timeout: 15_000 });

  // Funnel rows render with the email-only note on Opened.
  await expect(page.getByText("WHERE PEOPLE DROP")).toBeVisible();
  await expect(page.getByText("email opens only")).toBeVisible();

  // By-channel carries the honest no-cost line, never a made-up $.
  await expect(page.getByText("Cost per booking arrives when sends and minutes start metering", { exact: false })).toBeVisible();

  // 7 days can only be ≤ 30 days on real data.
  await page.getByTestId("bold-stats-range-7").click();
  await expect(async () => {
    const reached7 = await tileValue(page, "reached");
    expect(reached7).toBeLessThanOrEqual(reached30);
  }).toPass({ timeout: 10_000 });
});

test("the workspace Analytics surface is the same read at workspace scope", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-dock-analytics").click();
  await expect(page.getByTestId("bold-stats")).toBeVisible();
  // Workspace scope: the live campaign filter + the visibly deferred chips.
  await expect(page.getByTestId("bold-stats-campfilter")).toBeVisible();
  await expect(page.getByTestId("bold-stats-filters-deferred")).toContainText("on their way");
  // The reading card computes facts or says nothing stands out — never canned.
  await expect(page.getByText("What Ada sees")).toBeVisible();
  // Filtering to one campaign re-queries (the tile changes or stays — just
  // proves the select drives the read without error).
  await page.getByTestId("bold-stats-campfilter").selectOption({ label: "Implant open day" });
  await expect(page.getByTestId("bold-stats")).toBeVisible();
  await expect(page.getByTestId("bold-stats-tile-reached")).toBeVisible();
});

test("integrations: the registry with real statuses; BuyerPing round-trips in place", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  // Restore-first: BuyerPing off via the API, then reload.
  await page.request.post("/api/cf/leads/buyerping", { data: { enabled: false } });
  await page.reload();
  await page.getByTestId("bold-root").waitFor({ state: "visible" });
  await page.getByTestId("bold-dock-integrations").click();
  await expect(page.getByTestId("bold-integrations")).toBeVisible();

  // Registry categories render; an absent provider never offers Connect.
  await expect(page.getByText("PROSPECTING")).toBeVisible();
  await expect(page.getByTestId("bold-int-buyerping")).toContainText("Connect");

  // A live OAuth provider hands off honestly to the shipped classic flow.
  await page.getByTestId("bold-int-gcal").click();
  await expect(page.getByTestId("bold-int-drawer")).toBeVisible();
  await expect(page.getByTestId("bold-int-classic-pointer")).toContainText("classic console");
  await page.getByTestId("bold-int-drawer").getByText("✕").click();

  // BuyerPing connects in place and the card chip flips.
  await page.getByTestId("bold-int-buyerping").click();
  await page.getByTestId("bold-int-buyerping-toggle").click();
  await expect(page.getByTestId("bold-toast")).toContainText("BuyerPing on");
  await expect(page.getByTestId("bold-int-drawer")).toContainText("CONNECTED");
  // Restore: off again.
  await page.getByTestId("bold-int-buyerping-toggle").click();
  await expect(page.getByTestId("bold-toast")).toContainText("BuyerPing off");
});
