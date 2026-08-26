import { test, expect, type Page } from "@playwright/test";

/**
 * B2.6 smoke — suggested campaigns (DEC-110, closes Q-066). The shell fires
 * the deterministic sweep on load; the seeded not-now reply (Sofia,
 * objection_timing) makes the winback signal fire, so a REAL draft campaign
 * appears in the rail's ✦ ADA SUGGESTS block and as a campaigns-page row.
 * Start opens the create flow ON the draft (goal + summary prefilled);
 * dismiss stamps the marker and survives a reload (the signal never
 * re-suggests). The suggested row is deleted in cleanup so every run starts
 * from a fresh sweep.
 */

const OWNER_EMAIL = "owner@demo-agency.test";
const SUGG_NAME = "Win back the not-nows";

async function deleteSuggestionRow(page: Page) {
  try {
    const agents = (await (await page.request.get("/api/cf/agents")).json()) as Array<{ id: string; name: string }>;
    const row = agents.find((a) => a.name === SUGG_NAME);
    if (row) await page.request.delete(`/api/cf/agents/${row.id}`);
  } catch {
    // best-effort
  }
}

test.afterEach(async ({ page }) => {
  await deleteSuggestionRow(page);
});

async function signIn(page: Page): Promise<boolean> {
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
  return true;
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

test("the sweep proposes a real draft; start prefills the create flow; dismiss survives reload", async ({ page }) => {
  test.setTimeout(120_000);
  if (!(await signIn(page))) return;
  // Fresh slate: any leftover suggestion row (fired, dismissed or probed)
  // goes away so THIS load's sweep re-creates it deterministically.
  await deleteSuggestionRow(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  // The rail's ✦ block renders the swept draft with its factual reason.
  const suggests = page.getByTestId("bold-suggests");
  await expect(suggests).toBeVisible({ timeout: 15_000 });
  await expect(suggests).toContainText("ADA SUGGESTS");
  await expect(suggests).toContainText(SUGG_NAME);
  // Never a double row: the campaigns list excludes the suggested draft.
  await expect(page.getByTestId("bold-camps-list").getByText(SUGG_NAME)).toHaveCount(0);

  // The campaigns page carries the suggested row at the BOTTOM (prototype
  // placement): mint name pill + amber status pill + data-derived reason +
  // the filled "Start it"; the header count excludes it (owner ruling).
  await page.getByText("All", { exact: true }).click();
  await expect(page.getByTestId("bold-page-title")).toHaveText("Campaigns");
  await expect(page.getByText(/^4 CAMPAIGNS$/)).toBeVisible();
  const suggRow = page.getByTestId(/bold-sugg-row-/);
  await expect(suggRow).toContainText(SUGG_NAME);
  await expect(suggRow).toContainText("✦ Ada's idea");
  await expect(suggRow).toContainText("SUGGESTED");
  await expect(suggRow).toContainText("said not now or pushed back");
  // Bottom placement: the last campaign-list row is the suggestion.
  const pageRows = page.getByTestId("bold-camps-page").locator('[data-testid^="bold-camprow-"], [data-testid^="bold-sugg-row-"]');
  await expect(pageRows.last()).toContainText(SUGG_NAME);

  // Start it → the create flow opens ON the draft: goal + summary prefilled.
  await suggRow.getByText("Start it", { exact: true }).click();
  await expect(page.getByTestId("bold-create")).toBeVisible();
  await expect(page.getByTestId("bold-goal-winback_deals")).toContainText("✓");
  await expect(page.getByTestId("bold-create-spec")).toHaveValue("Win back the deals that said not now");
  await page.getByTestId("bold-create-cancel").click();

  // Dismiss from the rail; the flash confirms and the block empties.
  const dismiss = page.getByTestId(/bold-sugg-dismiss-/);
  await dismiss.click();
  await expect(page.getByTestId("bold-toast")).toContainText("she will not re-suggest it");
  await expect(page.getByTestId("bold-suggests")).toHaveCount(0);

  // Reload: the sweep runs again but the dismissed row suppresses the signal.
  await toBold(page);
  await page.waitForTimeout(2_500);
  await expect(page.getByTestId("bold-suggests")).toHaveCount(0);
});
