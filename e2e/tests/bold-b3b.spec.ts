import { test, expect, type Page } from "@playwright/test";

/**
 * B3b smoke — the reply spine (DEC-116/117). A human reply on the seeded
 * email thread goes through the REAL send boundary (keyless sandbox
 * transport locally — nothing delivered, everything persisted), the
 * reply-hold appears with its explicit Resume, and assign + snooze
 * round-trip through ThreadState. Self-restoring where the world allows:
 * holds are resumed, assignment and snooze are cleared. The sent reply
 * itself is a permanent, honest ledger row — the b2 spec's counts went
 * live-numeric for exactly this reason.
 */

// Both tests work the same seeded thread — keep them sequential in-file
// (the b26 shared-fixture convention under fullyParallel).
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

async function toWsInbox(page: Page): Promise<boolean> {
  await page.goto("/bold");
  try {
    await page.getByTestId("bold-root").waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  const later = page.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.getByTestId("bold-dock-wsinbox").click();
  await expect(page.getByTestId("bold-inbox")).toBeVisible();
  return true;
}

async function selectAlan(page: Page) {
  const alan = page.getByTestId(/bold-inbox-thread-/).filter({ hasText: "Alan Turing" });
  await expect(alan).toHaveCount(1);
  await alan.click();
  await expect(page.getByTestId("bold-inbox-sel-name")).toHaveText("Alan Turing");
}

test("a human reply sends through the boundary, holds Ada, and Resume releases her", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toWsInbox(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await selectAlan(page);

  // If a previous run left the hold in place, restore first.
  const staleHeld = page.getByTestId("bold-inbox-held");
  if (await staleHeld.isVisible().catch(() => false)) {
    await page.getByTestId("bold-inbox-resume").click();
    await expect(staleHeld).toHaveCount(0);
  }

  // The composer: real credits line (data, not a constant) + the draft offer.
  const composer = page.getByTestId("bold-inbox-composer");
  await expect(composer).toBeVisible();
  await expect(composer).toContainText("credit");
  await expect(page.getByTestId("bold-inbox-askdraft")).toContainText("Ask Ada to draft");

  // Send a reply. It persists as a real OUTBOUND row with human provenance.
  const stamp = `Most people are back to normal food in three days. (e2e ${Date.now()})`;
  await page.getByTestId("bold-inbox-replytext").fill(stamp);
  await page.getByTestId("bold-inbox-send").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Sent to Alan Turing");
  await expect(page.getByTestId("bold-inbox-sent")).toContainText("Ada is watching for the reply");
  await expect(page.getByTestId("bold-inbox-pane").getByText(stamp)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("bold-inbox-pane").getByText("you replied").first()).toBeVisible();

  // The reply-hold: Ada pauses for this person until the explicit Resume.
  await expect(page.getByTestId("bold-inbox-held")).toContainText("Ada is paused");
  await page.getByTestId("bold-inbox-resume").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Ada resumes");
  await expect(page.getByTestId("bold-inbox-held")).toHaveCount(0);
});

test("assign and snooze round-trip; the picker rows are live", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toWsInbox(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await selectAlan(page);

  // Assign to me → the header chip + the "Assigned to me" picker row count.
  await page.getByTestId("bold-inbox-assign").click();
  await page.getByTestId(/bold-inbox-assign-/).filter({ hasText: "Demo Owner" }).click();
  await expect(page.getByTestId("bold-toast")).toContainText("Assigned");
  await expect(page.getByTestId("bold-inbox-assign")).toContainText("Demo Owner", { timeout: 15_000 });
  await page.getByTestId("bold-inbox-picker-status").click();
  await expect(page.getByTestId("bold-inbox-opt-status-assigned")).toContainText("1");
  await page.getByTestId("bold-inbox-picker-status").click();

  // Snooze → the thread leaves "Needs reply" and counts under Snoozed.
  await page.getByTestId("bold-inbox-snooze").click();
  await page.getByTestId("bold-inbox-snooze-1").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Snoozed until");
  await expect(page.getByTestId("bold-inbox-snooze")).toContainText("Snoozed ·", { timeout: 15_000 });
  await page.getByTestId("bold-inbox-picker-status").click();
  await expect(page.getByTestId("bold-inbox-opt-status-snoozed")).toContainText("1");
  await page.getByTestId("bold-inbox-picker-status").click();

  // Restore: clear the snooze, unassign.
  await page.getByTestId("bold-inbox-snooze").click();
  await page.getByTestId("bold-inbox-unsnooze").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Snooze cleared");
  await page.getByTestId("bold-inbox-assign").click();
  await page.getByTestId("bold-inbox-unassign").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Unassigned");
  await expect(page.getByTestId("bold-inbox-assign")).toContainText("Assign", { timeout: 15_000 });
});
