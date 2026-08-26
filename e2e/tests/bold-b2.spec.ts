import { test, expect, type Page } from "@playwright/test";

/**
 * B2 smoke — pipeline board/list, plan + branches, campaign inbox go live
 * behind `consoleBold`. Asserts against the B1+B2 seed fixtures
 * (packages/db/prisma/seed.ts): the stored implant graph (seed-step-1 email ·
 * wait 3 days · seed-step-2 sms · reply branch), Ada booked/handled, Alan
 * needs-reply (email), Sofia needs-reply (sms, "Not now"), and the seeded
 * platform credit prices (email 1 · sms segment 5).
 *
 * Mutating flows restore their state (move → move back, handle → reopen,
 * timezone → back to UTC) so the suite is re-runnable against one DB.
 */

// fullyParallel would fan this file's tests across workers — but they share
// one seeded fixture (Sofia's stage/done flag), so they run in order here.
// The inbox test runs FIRST: it normalizes any state a previously-failed run
// left behind, then restores it, so the later tests see the canonical seed.
test.describe.configure({ mode: "default" });

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

async function openImplant(page: Page, tab: string) {
  await page.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await expect(page.getByTestId("bold-page-title")).toHaveText("Implant open day");
  await page.getByTestId(`bold-tab-${tab}`).click();
}

test("inbox pickers carry live counts; move, handle and the person peek are live", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await openImplant(page, "inbox");
  await expect(page.getByTestId("bold-inbox")).toBeVisible();
  const pane = page.getByTestId("bold-inbox-pane");

  // Normalize whatever a previously-failed run left behind (self-healing,
  // the timezone flow's posture): Sofia back to Interested and unhandled.
  await page.getByTestId(/bold-inbox-thread-/).filter({ hasText: "Sofia Reyes" }).click();
  await expect(page.getByTestId("bold-inbox-sel-name")).toHaveText("Sofia Reyes");
  if (!((await page.getByTestId("bold-inbox-move").textContent()) ?? "").includes("Interested")) {
    await page.getByTestId("bold-inbox-move").click();
    await page.getByTestId("bold-inbox-move-interested").click();
    await expect(page.getByTestId("bold-inbox-move")).toContainText("Interested");
  }
  if (((await page.getByTestId("bold-inbox-donebar").textContent()) ?? "").includes("Handled.")) {
    await page.getByTestId("bold-inbox-done").click();
    await expect(page.getByTestId("bold-inbox-donebar")).toContainText("Mark handled");
  }

  // TYPE: live counts for the types with data; the sourceless rows are
  // disabled-with-their-wave, never silently dropped (Q-070).
  await page.getByTestId("bold-inbox-picker-type").click();
  await expect(page.getByTestId("bold-inbox-opt-type-email")).toContainText("2");
  await expect(page.getByTestId("bold-inbox-opt-type-sms")).toContainText("1");
  await expect(page.getByTestId("bold-inbox-opt-type-web")).toContainText("Coming soon");
  await page.getByTestId("bold-inbox-opt-type-sms").click();
  await expect(page.getByTestId(/bold-inbox-thread-/)).toHaveCount(1);
  await page.getByTestId("bold-inbox-picker-type").click();
  await page.getByTestId("bold-inbox-opt-type-all").click();
  await expect(page.getByTestId(/bold-inbox-thread-/)).toHaveCount(3);

  // STATUS counts: Ada handled · Alan + Sofia need a reply · Ada booked.
  await page.getByTestId("bold-inbox-picker-status").click();
  await expect(page.getByTestId("bold-inbox-opt-status-needs")).toContainText("2");
  await expect(page.getByTestId("bold-inbox-opt-status-booked")).toContainText("1");
  await expect(page.getByTestId("bold-inbox-opt-status-handled")).toContainText("1");
  await page.getByTestId("bold-inbox-opt-status-all").click();

  // Sofia's SMS thread: both bubbles render; the reply carries its intent
  // label; the stage pill reads the live enrollment.
  await page.getByTestId(/bold-inbox-thread-/).filter({ hasText: "Sofia Reyes" }).click();
  await expect(page.getByTestId("bold-inbox-sel-name")).toHaveText("Sofia Reyes");
  await expect(pane.getByText("Can this wait until early next month? Mid-move right now.")).toBeVisible();
  await expect(pane.getByText(/Not now/)).toBeVisible();
  await expect(page.getByTestId("bold-inbox-move")).toContainText("Interested");

  // Move — the bus-publishing enrollment PATCH — then restored.
  await page.getByTestId("bold-inbox-move").click();
  await page.getByTestId("bold-inbox-move-engaged").click();
  await expect(page.getByTestId("bold-inbox-move")).toContainText("Engaged");
  await page.getByTestId("bold-inbox-move").click();
  await page.getByTestId("bold-inbox-move-interested").click();
  await expect(page.getByTestId("bold-inbox-move")).toContainText("Interested");

  // Mark handled / reopen (PATCH /messages/:id/done on the last inbound).
  await page.getByTestId("bold-inbox-done").click();
  await expect(page.getByTestId("bold-inbox-donebar")).toContainText("Handled.");
  await page.getByTestId("bold-inbox-done").click();
  await expect(page.getByTestId("bold-inbox-donebar")).toContainText("Mark handled");

  // Ada's thread interleaves the payment system row from the events read.
  await page.getByTestId(/bold-inbox-thread-/).filter({ hasText: "Ada Lovelace" }).click();
  await expect(pane.getByText(/Payment received/)).toBeVisible();

  // The person peek renders the shipped timeline read.
  await page.getByTestId("bold-inbox-profile").click();
  const drawer = page.getByTestId("bold-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Ada Lovelace");
  await expect(drawer).toContainText("TIMELINE");
  await page.mouse.click(300, 300);
  await expect(drawer).toHaveCount(0);
});

test("pipeline board groups the real stages; the list carries honest values", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await openImplant(page, "pipeline");

  // Board columns are the WORKSPACE stage set (7 seeded), never the
  // prototype's four sample columns.
  const board = page.getByTestId("bold-pipe-board");
  await expect(board).toBeVisible();
  for (const key of ["new", "contacted", "engaged", "interested", "booked", "won", "lost"]) {
    await expect(page.getByTestId(`bold-pipe-col-${key}`)).toBeVisible();
  }
  const interested = page.getByTestId("bold-pipe-col-interested");
  await expect(interested).toContainText("Sofia Reyes");
  // Value honesty: POTENTIAL vocabulary on the goal column only; earlier
  // stages carry the prototype's honest "no value yet".
  await expect(page.getByTestId("bold-pipe-col-booked")).toContainText("$2,400 potential");
  await expect(page.getByTestId("bold-pipe-col-contacted")).toContainText("no value yet");

  // List view: same data as a table; Ada carries the estimate, Sofia a dash.
  await page.getByTestId("bold-pipe-view-list").click();
  const list = page.getByTestId("bold-pipe-list");
  await expect(list).toBeVisible();
  const adaRow = list.getByTestId("bold-pipe-row").filter({ hasText: "Ada Lovelace" });
  await expect(adaRow).toContainText("Booked");
  await expect(adaRow).toContainText("$2,400");

  // Stage filter narrows the list.
  await page.getByTestId("bold-pipe-stage-interested").click();
  await expect(list.getByTestId("bold-pipe-row").filter({ hasText: "Ada Lovelace" })).toHaveCount(0);
  await expect(list.getByTestId("bold-pipe-row").filter({ hasText: "Sofia Reyes" })).toHaveCount(1);
});

test("plan renders the stored graph with credit costs; the step sheet and timezone edit are live", async ({ page }) => {
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await openImplant(page, "plan");

  // The DEC-076 honesty line rides a live campaign's plan.
  await expect(page.getByTestId("bold-plan-notice")).toContainText("mid-sequence");

  // The sequence: real nodes, day math, and credit costs from the resolved
  // CreditPrice read (email 1 · sms segment 5 — the seeded platform defaults).
  const s1 = page.getByTestId("bold-plan-node-seed-step-1");
  await expect(s1).toContainText("Four consult slots left for the 21st");
  await expect(s1).toContainText("DAY 1");
  await expect(s1).toContainText("1 CREDIT / SEND");
  await expect(page.getByTestId("bold-plan-node-seed-delay-1")).toContainText("3 DAYS");
  const s2 = page.getByTestId("bold-plan-node-seed-step-2");
  await expect(s2).toContainText("DAY 4");
  await expect(s2).toContainText("5 CREDITS / SEGMENT");
  await expect(page.getByTestId("bold-plan-node-seed-branch-reply")).toContainText("When they reply");

  // Branch cards: the shipped intent vocabulary + live conversation counts.
  const interested = page.getByTestId("bold-plan-branch-interested");
  await expect(interested).toContainText("Interested");
  await expect(interested).toContainText("1 step");
  await expect(page.getByTestId("bold-plan-branch-default")).toContainText("Any other reply");

  // The step sheet: chips are real perStep counts + the cost.
  await s1.click();
  const sheet = page.getByTestId("bold-plan-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("3 sent");
  await expect(sheet).toContainText("1 credit / send");
  await expect(sheet.getByTestId("bold-sheet-subject")).toHaveValue("Four consult slots left for the 21st");
  await page.mouse.click(300, 300);
  await expect(sheet).toHaveCount(0);

  // Sending window (legacy guardrails parse to the defaults) + timezone edit
  // through the shipped PATCH — then restored so the suite is re-runnable.
  const win = page.getByTestId("bold-plan-window");
  await expect(win).toContainText("Mon–Fri, 9:00–17:00");
  await expect(win).toContainText("no weekend sends");
  // A view refresh can replace the control mid-click — retry the open
  // (the same toPass posture as the sign-in workspace switch).
  const openTzPicker = async () => {
    await expect(async () => {
      await page.getByTestId("bold-plan-tz").click();
      await expect(page.getByTestId("bold-plan-tz-search")).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
  };
  await openTzPicker();
  await page.getByTestId("bold-plan-tz-search").fill("Chicago");
  await page.getByText("America/Chicago", { exact: true }).click();
  await expect(win).toContainText("America/Chicago");
  await openTzPicker();
  await page.getByTestId("bold-plan-tz-search").fill("UTC");
  await page.getByText("UTC", { exact: true }).click();
  await expect(win).toContainText("UTC · no weekend sends");
});
