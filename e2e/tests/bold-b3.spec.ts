import { test, expect, type Page } from "@playwright/test";

/**
 * B3a smoke — workspace inbox (read + triage) + contacts (DEC-112). The
 * workspace inbox renders every campaign's threads from `GET /inbox` with
 * campaign attribution and the CAMPAIGN picker; triage actions are the
 * shipped writes (mark handled toggles and is restored). The contacts page
 * renders the shipped contacts view (segments, search, lists, person
 * detail with campaigns + timeline), and the drawer's Message action lands
 * on that contact's workspace-inbox thread. Self-restoring: handled state
 * is reopened; nothing is created.
 */

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

test("workspace inbox: attribution, campaign picker, triage round-trips", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-dock-wsinbox").click();
  await expect(page.getByTestId("bold-inbox")).toBeVisible();
  // Live eyebrow — a real count, never the prototype's fixture number.
  await expect(page.getByText(/^WORKSPACE · \d+ CONVERSATIONS?$/)).toBeVisible();

  // The seeded thread world: Ada (handled), Alan (needs reply), Sofia (SMS).
  await expect(page.getByTestId(/bold-inbox-thread-/).first()).toBeVisible();
  const threads = page.getByTestId(/bold-inbox-thread-/);
  await expect(threads.filter({ hasText: "Alan Turing" })).toHaveCount(1);
  // Campaign attribution rides every thread row (workspace scope).
  await expect(threads.filter({ hasText: "Implant open day" }).first()).toBeVisible();

  // The workspace-wide selector: per-campaign rows with live counts.
  await page.getByTestId("bold-inbox-picker-camp").click();
  const campOpt = page.getByTestId(/bold-inbox-opt-camp-/).filter({ hasText: "Implant open day" });
  await expect(campOpt).toHaveCount(1);
  await campOpt.click();
  await expect(threads.filter({ hasText: "Alan Turing" })).toHaveCount(1);

  // Select Alan's thread; the pane header carries the campaign pill.
  await threads.filter({ hasText: "Alan Turing" }).click();
  await expect(page.getByTestId("bold-inbox-sel-name")).toHaveText("Alan Turing");
  await expect(page.getByTestId("bold-inbox-sel-camp")).toContainText("Implant open day");
  await expect(page.getByTestId("bold-inbox-pane").getByText("What does recovery look like?")).toBeVisible();

  // Triage round-trip: mark handled, then reopen (self-restoring).
  await page.getByTestId("bold-inbox-done").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Marked handled");
  await expect(page.getByTestId("bold-inbox-donebar")).toContainText("Handled.");
  await page.getByTestId("bold-inbox-done").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Reopened");
  await expect(page.getByTestId("bold-inbox-donebar")).toContainText("read and triage");
});

test("contacts: segments, search, person detail, Message lands on the thread", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-dock-contacts").click();
  await expect(page.getByTestId("bold-contacts")).toBeVisible();
  await expect(page.getByText(/^\d+ (PEOPLE|PERSON)$/)).toBeVisible();

  // Seeded people render as grid cards with the derived tag.
  const adaCard = page.getByTestId(/bold-ct-card-/).filter({ hasText: "Ada Lovelace" });
  await expect(adaCard).toHaveCount(1);
  await expect(adaCard).toContainText("Booked"); // stage booked → the factual tag

  // Search narrows across names.
  await page.getByTestId("bold-ct-search").fill("Alan Turing");
  await expect(page.getByTestId(/bold-ct-card-/).filter({ hasText: "Alan Turing" })).toHaveCount(1);
  await expect(page.getByTestId(/bold-ct-card-/).filter({ hasText: "Ada Lovelace" })).toHaveCount(0);
  await page.getByTestId("bold-ct-search").fill("");

  // Customers = derived stage-won query; the demo seed has none — the
  // booked row must NOT masquerade as a customer.
  await page.getByTestId("bold-ct-seg-customers").click();
  await expect(page.getByTestId(/bold-ct-card-/).filter({ hasText: "Ada Lovelace" })).toHaveCount(0);
  await page.getByTestId("bold-ct-seg-all").click();

  // List view: the prototype's row anatomy + per-row add-to-list.
  await page.getByTestId("bold-ct-view-list").click();
  await expect(page.getByText("POTENTIAL")).toBeVisible();
  const adaRow = page.getByTestId(/bold-ct-row-/).filter({ hasText: "Ada Lovelace" });
  await expect(adaRow).toContainText("ada@demo-agency.test");

  // Person detail: avatar header, campaigns, timeline.
  await adaRow.click();
  await expect(page.getByTestId("bold-person-name")).toHaveText("Ada Lovelace");
  await expect(page.getByTestId("bold-drawer")).toContainText("CAMPAIGNS");
  await expect(page.getByTestId(/bold-person-camp-/).first()).toContainText("Implant open day");
  await expect(page.getByTestId("bold-drawer")).toContainText("TIMELINE");

  // Review round: the notes field carries the ruled placeholder; Call/Book
  // and the next-step slot are visibly deferred; the ✦ footer states this
  // contact's real signal fact (a booked outcome). Tags write round-trips
  // and self-restores.
  await expect(page.getByTestId("bold-person-notes")).toHaveAttribute(
    "placeholder",
    "Anything Ada should know — she reads these before she writes.",
  );
  await expect(page.getByTestId("bold-person-call")).toContainText("Coming soon");
  await expect(page.getByTestId("bold-person-book")).toContainText("Coming soon");
  await expect(page.getByTestId("bold-person-nextstep")).toContainText("Coming soon");
  await expect(page.getByTestId("bold-person-ada")).toContainText("Booked");
  await page.getByTestId("bold-person-tag-add").click();
  await page.getByTestId("bold-person-tag-input").fill("e2e-tag");
  await page.getByTestId("bold-person-tag-input").press("Enter");
  await expect(page.getByTestId("bold-person-tag-e2e-tag")).toBeVisible();
  await page.getByTestId("bold-person-tag-remove-e2e-tag").click();
  await expect(page.getByTestId("bold-person-tag-e2e-tag")).toHaveCount(0);

  // Message → the workspace inbox opens ON this contact's thread.
  await page.getByTestId("bold-person-message").click();
  await expect(page.getByTestId("bold-inbox")).toBeVisible();
  await expect(page.getByTestId("bold-inbox-sel-name")).toHaveText("Ada Lovelace", { timeout: 15_000 });
});
