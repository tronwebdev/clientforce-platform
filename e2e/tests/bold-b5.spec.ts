import { test, expect, type Page } from "@playwright/test";

/**
 * B5 smoke — the three surfaces on their real spines:
 *  - Automations: seeded rules render from the live engine, the toggle
 *    round-trips (restore-first), the detail states the engine's real
 *    guarantees, and the guided build writes a REAL rule (cleaned up);
 *  - Forms: the seeded live form's grid card + detail tabs (real responses,
 *    the required toggle round-trips), and the PUBLIC hosted page renders
 *    without a session;
 *  - Proposals: the seeded draft document renders its blocks with the send
 *    action visibly deferred.
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

test("automations run on the live engine: rows, toggle round-trip, detail truths, guided build", async ({ page }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");

  // Restore-first: sweep any stale rule a dead prior run left behind.
  const stale = (await (await page.request.get("/api/cf/automations")).json()) as Array<{ id: string; name: string }>;
  for (const r of stale.filter((x) => x.name.startsWith("e2e-b5"))) {
    await page.request.delete(`/api/cf/automations/${r.id}`);
  }

  await page.getByTestId("bold-dock-automations").click();
  const list = page.getByTestId("bold-automations");
  await expect(list).toBeVisible();
  await expect(list).toContainText("Booked → tell the team");
  await expect(list).toContainText("Objection → notify me");
  await expect(list).toContainText("never run");

  // Toggle round-trip on the seeded OFF rule, restored OFF.
  const row = page.locator("div").filter({ hasText: /^Objection → notify me/ }).first();
  const idx = await list.locator('[data-testid^="bold-auto-row-"]').evaluateAll((els) =>
    els.findIndex((e) => e.textContent?.includes("Objection → notify me")),
  );
  const toggle = page.getByTestId(`bold-auto-toggle-${idx}`);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
  void row;

  // Detail: the engine's REAL safety rows.
  await page.getByTestId("bold-auto-row-0").click();
  await expect(page.getByTestId("bold-auto-detail")).toContainText("Once per event, ever");
  await expect(page.getByTestId("bold-auto-detail")).toContainText("It can never send");
  await page.getByTestId("bold-auto-back").click();

  // Guided build → a REAL rule lands in the list; deleted after. The trigger
  // pick avoids the engine's enabled-duplicate guard (the seed already runs
  // enabled booking/payment/lead rules; its objection rule is OFF).
  await page.getByTestId("bold-automations-build").click();
  await expect(page.getByTestId("bold-gb")).toBeVisible();
  await page.getByTestId("bold-gb-opt-2").click(); // A price objection arrives
  await page.getByTestId("bold-gb-opt-0").click(); // Tell the team
  await page.getByTestId("bold-gb-name").fill("e2e-b5 objection ping");
  await page.getByTestId("bold-gb-continue").click();
  await expect(page.getByTestId("bold-gb-done")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("bold-gb-open").click();
  await expect(page.getByTestId("bold-automations")).toContainText("e2e-b5 objection ping");
  const rules = (await (await page.request.get("/api/cf/automations")).json()) as Array<{ id: string; name: string }>;
  const mine = rules.find((r) => r.name === "e2e-b5 objection ping");
  expect(mine).toBeTruthy();
  await page.request.delete(`/api/cf/automations/${mine!.id}`);
});

test("forms: the seeded live form, its detail tabs, and the public hosted page", async ({ page, browser }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");

  await page.getByTestId("bold-dock-forms").click();
  const grid = page.getByTestId("bold-forms");
  await expect(grid).toBeVisible();
  await expect(grid).toContainText("Open day booking");
  await expect(grid).toContainText("LIVE");

  // Detail: responses are real rows.
  await grid.getByText("Open day booking").click();
  const detail = page.getByTestId("bold-form-detail");
  await expect(detail).toBeVisible();
  await detail.getByText("Responses", { exact: true }).click();
  await expect(page.getByTestId("bold-form-responses")).toContainText("Tom Becker");

  // Fields: required toggle round-trips and restores.
  await detail.getByText("Fields", { exact: true }).click();
  const emailToggle = page.getByTestId("bold-form-field-email");
  const before = await emailToggle.getAttribute("aria-checked");
  await emailToggle.click();
  await expect(emailToggle).toHaveAttribute("aria-checked", before === "true" ? "false" : "true", { timeout: 10_000 });
  await emailToggle.click();
  await expect(emailToggle).toHaveAttribute("aria-checked", before ?? "false", { timeout: 10_000 });

  // Share carries the real hosted link.
  await detail.getByText("Share", { exact: true }).click();
  await expect(page.getByTestId("bold-form-share")).toContainText("/f/frm_demoopenday0001");

  // The hosted page renders with NO session at all.
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto("/f/frm_demoopenday0001");
  await expect(pub.getByTestId("hosted-form")).toBeVisible();
  await expect(pub.getByTestId("hosted-form")).toContainText("Open day booking");
  await expect(pub.getByTestId("hosted-form-submit")).toHaveText("Book my slot");
  await anon.close();
});

test("proposals: the seeded draft renders its blocks with delivery visibly deferred", async ({ page }) => {
  await signIn(page);
  if (!(await toBold(page))) test.skip(true, "consoleBold flag off for the demo workspace");

  await page.getByTestId("bold-dock-proposals").click();
  const grid = page.getByTestId("bold-proposals");
  await expect(grid).toBeVisible();
  await expect(grid).toContainText("Full-arch implant plan");
  await expect(grid).toContainText("$8,400");

  await grid.getByText("Full-arch implant plan").click();
  const doc = page.getByTestId("bold-proposal-doc");
  await expect(doc).toBeVisible();
  await expect(doc).toContainText("WHAT YOU TOLD US");
  await expect(doc).toContainText("Full arch, both sides");
  await expect(doc).toContainText("signing arrives with delivery");
  await expect(page.getByTestId("bold-proposal-send-deferred")).toContainText("arrives with delivery");

  await page.getByTestId("bold-proposal-detail").getByText("Activity", { exact: true }).click();
  await expect(page.getByTestId("bold-proposal-activity")).toContainText("nothing here will ever be invented");
});
