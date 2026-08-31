import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL } from "./_fixtures";

/**
 * B6 smoke — the Lead finder on its real seam, keyless posture throughout
 * (no APOLLO_API_KEY locally): Ada's matches rank the demo workspace's OWN
 * book with the honest keyless ICP copy; Direct modes render the
 * provider-not-connected state — never fixture rows; the BuyerPing chip +
 * drawer round-trip the tier (restore-first: disconnected at the end) and
 * the watch-topics editor writes real rows.
 */

test.describe.configure({ mode: "serial" });

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

test("Ada's matches rank the own book keylessly; Direct modes say the provider isn't connected", async ({ page }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");
  // Restore-first: a dead prior run may have left the tier connected.
  await page.request.post("/api/cf/leads/buyerping", { data: { enabled: false } });
  await page.reload();
  await page.getByTestId("bold-root").waitFor();

  await page.getByTestId("bold-dock-lead").click();
  const surface = page.getByTestId("bold-leadfinder");
  await expect(surface).toBeVisible();

  // The keyless ICP card says the truth: her pool is YOUR book.
  await expect(page.getByTestId("bold-lead-icp")).toContainText("rank YOUR book", { timeout: 15_000 });
  await expect(page.getByTestId("bold-lead-bp-chip")).toContainText("Add buyer intent");

  // Wait for the auto-run search to settle, then: own-book candidates with
  // "In your book" provenance — or the honest empty state; either way,
  // never a provider fixture.
  await expect(page.getByTestId("bold-lead-search")).toContainText("Search again", { timeout: 15_000 });
  const count = page.getByTestId("bold-lead-count");
  if (await count.isVisible().catch(() => false)) {
    await expect(surface).toContainText("In your book");
  } else {
    await expect(surface).toContainText("Nothing to stage yet");
  }

  // Direct modes: the not-connected state, no rows.
  await page.getByTestId("bold-lead-mode-own").click();
  await expect(page.getByTestId("bold-lead-noprovider")).toBeVisible();
  await expect(page.getByTestId("bold-lead-noprovider")).toContainText("The lead-data provider");
  await page.getByTestId("bold-lead-mode-legacy").click();
  await expect(page.getByTestId("bold-lead-noprovider")).toBeVisible();
  await expect(surface).toContainText("Save this search — coming soon");
});

test("the BuyerPing drawer round-trips the tier and the watch-topics editor writes real rows", async ({ page }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");
  await page.request.post("/api/cf/leads/buyerping", { data: { enabled: false } });
  await page.reload();
  await page.getByTestId("bold-root").waitFor();

  await page.getByTestId("bold-dock-lead").click();
  await page.getByTestId("bold-lead-bp-chip").click();
  const drawer = page.getByTestId("bold-lead-bp");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("not connected");
  await expect(drawer).toContainText("Ada still matches on fit");

  // Restore-first: a dead prior run may have left the tier on or a topic behind.
  const topicChip = drawer.getByText("✓ e2e-b6 topic");
  if (await topicChip.isVisible().catch(() => false)) await topicChip.click();

  // Connect → the tier flips on (the drawer stays open); a custom topic
  // lands and removes.
  await page.getByTestId("bold-lead-bp-toggle").click();
  await expect(drawer).toContainText("Connected ·", { timeout: 10_000 });
  await page.getByTestId("bold-lead-topic-input").fill("e2e-b6 topic");
  await page.getByTestId("bold-lead-topic-add").click();
  await expect(drawer).toContainText("✓ e2e-b6 topic", { timeout: 10_000 });
  await drawer.getByText("✓ e2e-b6 topic").click();
  await expect(drawer).not.toContainText("✓ e2e-b6 topic", { timeout: 10_000 });

  // Disconnect — the tier restores OFF (fit matching still runs), and the
  // chip behind the closed drawer says so.
  await page.getByTestId("bold-lead-bp-toggle").click();
  await expect(drawer).toContainText("not connected", { timeout: 10_000 });
  await page.getByTestId("bold-lead-bp-close").click();
  await expect(page.getByTestId("bold-lead-bp-chip")).toContainText("Add buyer intent", { timeout: 10_000 });
});
