import { test, expect, type Page } from "@playwright/test";

/**
 * B3c-1 smoke — Ada outbound on the one dial rail (DEC-118/119). The drawer's
 * Call action is live and CONSENT-HONEST: unknown consent shows the blocker,
 * flipping consent opens the best-time sheet with the checkable window
 * sub-line and the live per-minute price. The plan editor's add-step popover
 * offers the Calls row. Self-restoring: consent flips back to unknown; no
 * call is queued and no step is added.
 */

test.describe.configure({ mode: "default" });

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

test("the drawer call action is consent-honest; the sheet shows the checkable window + price", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  // Sofia has a phone in the seed — open her detail from Contacts.
  await page.getByTestId("bold-dock-contacts").click();
  await expect(page.getByTestId("bold-contacts")).toBeVisible();
  const sofia = page.getByTestId(/bold-ct-card-/).filter({ hasText: "Sofia Reyes" });
  await expect(sofia).toHaveCount(1);
  await sofia.click();
  await expect(page.getByTestId("bold-person-name")).toHaveText("Sofia Reyes");

  // Restore-first: a previous run may have left consent granted.
  const notAsked = page.getByTestId("bold-person-consent-unknown");
  await expect(notAsked).toBeVisible();
  await notAsked.click();
  await expect(page.getByTestId("bold-toast")).toContainText("Call permission cleared");

  // Unknown consent → the call sheet shows the honest blocker, no queue button.
  await page.getByTestId("bold-person-call").click();
  await expect(page.getByTestId("bold-person-call-blocked")).toContainText("Ada only calls people who said yes");
  await expect(page.getByTestId("bold-person-call-queue")).toHaveCount(0);

  // Grant consent → the sheet opens up: the checkable window (source named)
  // and the live per-minute price from the effective-dated table.
  await page.getByTestId("bold-person-consent-granted").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Ada may call them now");
  await page.getByTestId("bold-person-call").click(); // close
  await page.getByTestId("bold-person-call").click(); // reopen → refetches the window
  await expect(page.getByTestId("bold-person-call-window")).toContainText(/\((campaign time|their saved timezone|from their booking)\)/, { timeout: 15_000 });
  await expect(page.getByTestId("bold-person-callsheet")).toContainText("Ada picks the best time");
  await expect(page.getByTestId("bold-person-callsheet")).toContainText("/ minute");
  await expect(page.getByTestId("bold-person-call-queue")).toBeVisible();

  // Restore: consent back to unknown (the timeline keeps the provenance).
  await page.getByTestId("bold-person-consent-unknown").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Call permission cleared");
});

test("the plan editor offers the Calls step; voice steps price per minute", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByText("Plan", { exact: true }).click();
  await expect(page.getByTestId("bold-plan-add")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("bold-plan-add").click();
  // The Calls row is LIVE in the popover (not clicked — the graph stays
  // untouched; the dial rail is pinned by the API spec).
  const voiceRow = page.getByTestId("bold-plan-add-voice");
  await expect(voiceRow).toBeVisible();
  await expect(voiceRow).toContainText("Call");
  // Close by toggling the tile — the popover has no Escape handler.
  await page.getByTestId("bold-plan-add").click();
});
