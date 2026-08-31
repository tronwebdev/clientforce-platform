import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL } from "./_fixtures";

/**
 * B3d smoke — autonomy + the approvals queue. The campaign Settings tab is
 * live with the three-level radio (round-trips through the guardrails PATCH
 * and self-restores to the default). The campaign Overview carries the amber
 * needs strip with LIVE counts; opening it lists typed items, and a
 * reply item's action lands on the campaign Inbox.
 */

test.describe.configure({ mode: "default" });

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

test("the settings-tab autonomy radio round-trips and self-restores", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByTestId("bold-settings")).toBeVisible({ timeout: 15_000 });

  // Wait for the LOADED state — exactly one radio is checked once the
  // guardrails read lands (before that, none are, and a click is a no-op).
  await expect(page.locator('[data-testid^="bold-auto-"][aria-checked="true"]')).toHaveCount(1, { timeout: 15_000 });
  // Restore-first: a previous run may have left a non-default level.
  const limits = page.getByTestId("bold-auto-limits");
  await expect(limits).toBeVisible();
  if ((await limits.getAttribute("aria-checked")) !== "true") {
    await limits.click();
    await expect(page.getByTestId("bold-toast")).toContainText("Act inside limits");
  }
  await expect(limits).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });

  // Flip to ask-first, verify it survives a reload, then restore the default.
  await page.getByTestId("bold-auto-ask").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Ask me first");
  await page.reload();
  const later = page.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByTestId("bold-auto-ask")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  await page.getByTestId("bold-auto-limits").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Act inside limits");
  // B7 (DEC-133): the once-deferred sections shipped — channel toggles and
  // typed cap wells now render below the radio instead of the deferred note.
  await expect(page.getByTestId("bold-ch-email")).toBeVisible();
  await expect(page.getByTestId("bold-gr-cap-email")).toBeVisible();
});

test("the overview needs strip counts live items; a reply item lands on the inbox", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  // The seeded world holds a needs-reply thread (Alan) — the strip is live.
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  const strip = page.getByTestId("bold-needs-strip");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await expect(strip).toContainText("Review →");

  await strip.click();
  await expect(page.getByTestId("bold-approvals")).toBeVisible();
  const replyItem = page.getByTestId("bold-approval-item-reply_draft").first();
  await expect(replyItem).toBeVisible();
  await expect(replyItem).toContainText("Reply waiting");
  await replyItem.getByTestId("bold-approval-open-inbox").click();
  await expect(page.getByTestId("bold-inbox")).toBeVisible({ timeout: 15_000 });
});
