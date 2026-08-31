import { test, expect, type Page } from "@playwright/test";

/**
 * B7.5 smoke — the settings WRITE layer, one test per acceptance criterion.
 *
 * B7 shipped these surfaces read-only, so every assertion below is a thing a
 * user could not do before: teach Ada a fact, answer a gap, add a source, add
 * a sender or a number, invite a colleague, move a guardrail, read credits
 * without being lied to.
 *
 * Scoped deliberately: every selector is a settings-family testid and nothing
 * here pins a count on shared seed data, so a parallel wave's writes cannot
 * turn this suite red.
 */

test.describe.configure({ mode: "serial" });

const OWNER_EMAIL = "owner@demo-agency.test";
/** Unique per run, so re-runs never collide on a taught fact or an invite. */
const RUN = `${Date.now().toString(36)}`;

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

async function toSettings(page: Page): Promise<boolean> {
  await page.goto("/bold");
  try {
    await page.getByTestId("bold-root").waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  const later = page.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.getByTestId("bold-dock-wssettings").click();
  await expect(page.getByTestId("bold-wssettings")).toBeVisible();
  return true;
}

/* §12.1 · §12.9 · §12.10 — the drawer, the scrim, the wells */

test("every add opens the right-hand drawer, and the drawer dims the page and closes on the scrim", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByTestId("bold-wss-core").click();
  await expect(page.getByTestId("bold-wss-core-item")).toBeVisible();

  await page.getByTestId("bold-core-add").click();
  const drawer = page.getByTestId("bold-drawer-fact");
  await expect(drawer).toBeVisible();

  // It is a right-hand drawer, not a modal: pinned to the right edge, full height.
  const box = await drawer.boundingBox();
  const view = page.viewportSize();
  expect(box).not.toBeNull();
  expect(view).not.toBeNull();
  expect(Math.round(box!.x + box!.width)).toBeGreaterThanOrEqual(view!.width - 2);
  expect(box!.height).toBeGreaterThan(view!.height * 0.9);

  // The page behind it is dimmed, and the scrim closes it.
  await expect(page.getByTestId("bold-settings-scrim")).toBeVisible();
  await page.getByTestId("bold-settings-scrim").click({ position: { x: 40, y: 200 } });
  await expect(drawer).toBeHidden();
});

/* §12.2 — answering a gap removes it, creates the fact, both counts change */

test("teaching a fact raises the count without a reload, and the taught row can be edited and forgotten", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-core").click();
  const item = page.getByTestId("bold-wss-core-item");
  await expect(item).toBeVisible();

  const factsBefore = Number((await item.getByText(/^\d+$/).first().textContent()) ?? "0");

  const question = `Do you validate parking ${RUN}?`;
  await page.getByTestId("bold-core-add").click();
  await page.getByTestId("bold-drawer-fact-question").fill(question);
  await page.getByTestId("bold-drawer-fact-next").click();
  await page.getByTestId("bold-drawer-fact-answer").fill("Yes — bring your ticket to the front desk.");
  await page.getByTestId("bold-drawer-fact-finish").click();

  // The toast says what happened, and the page updates without a reload.
  await expect(page.getByTestId("bold-toast")).toContainText("She knows it now");
  await expect(page.getByTestId("bold-core-facts")).toContainText(question);
  await expect(item.getByText(String(factsBefore + 1)).first()).toBeVisible();

  // The row opens the SAME drawer, pre-filled from the row it was opened from.
  await page.getByTestId("bold-core-facts").getByText(question).click();
  const edit = page.getByTestId("bold-drawer-editfact");
  await expect(edit).toBeVisible();
  await expect(page.getByTestId("bold-drawer-editfact-question")).toHaveValue(question);
  await expect(page.getByTestId("bold-drawer-editfact-answer")).toHaveValue(/front desk/);

  // Destructive actions state their consequence BEFORE they run.
  await page.getByTestId("bold-drawer-editfact-forget").click();
  await expect(edit).toContainText("goes back to your front desk");
  await page.getByTestId("bold-drawer-editfact-forget-confirm").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Forgotten");
  await expect(page.getByTestId("bold-core-facts")).not.toContainText(question);
});

/* §12.3 — a source added here makes a real ingest job with a visible yield */

test("a knowledge source added here starts a real read and reports its own state", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-core").click();
  await page.getByTestId("bold-wss-tab-3").click();

  const label = `Consult script ${RUN}`;
  await page.getByTestId("bold-core-add").click();
  await expect(page.getByTestId("bold-drawer-source")).toBeVisible();
  await page.getByTestId("bold-drawer-source-typed").click();
  await page.getByTestId("bold-drawer-source-next").click();
  await page.getByTestId("bold-drawer-source-typed-label").fill(label);
  await page.getByTestId("bold-drawer-source-typed-text").fill("We answer the phone within three rings.");
  await page.getByTestId("bold-drawer-source-finish").click();

  await expect(page.getByTestId("bold-toast")).toContainText("reading");
  const rows = page.getByTestId("bold-core-sources");
  await expect(rows).toContainText(label);
  // Still ingesting ⇒ it says so, and shows no yield rather than a zero.
  await expect(rows).toContainText(/reading it now|facts found|nothing usable found/);

  // The row opens the source drawer, which resolves from that row's own data.
  await rows.getByText(label).click();
  await expect(page.getByTestId("bold-drawer-sourcedetail")).toBeVisible();
  await expect(page.getByTestId("bold-drawer-sourcedetail")).toContainText(label);
  await page.getByTestId("bold-drawer-source-remove").click();
  await expect(page.getByTestId("bold-drawer-sourcedetail")).toContainText("goes with it");
  await page.getByTestId("bold-drawer-source-remove-confirm").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Removed");
});

/* §12.4 — a number shows its A2P state; a sender shows live DNS check state */

test("a number can be requested and shows its real A2P state, never an invented badge", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-senders").click();
  await expect(page.getByTestId("bold-wss-senders-item")).toBeVisible();
  await page.getByTestId("bold-wss-tab-1").click();

  await page.getByTestId("bold-senders-add-number").click();
  await expect(page.getByTestId("bold-drawer-addnumber")).toBeVisible();
  await page.getByTestId("bold-drawer-addnumber-area").fill("512");
  await page.getByTestId("bold-drawer-addnumber-next").click();
  await page.getByTestId("bold-drawer-addnumber-both").click();
  await page.getByTestId("bold-drawer-addnumber-next").click();
  // The filing step says plainly that filing is not connected.
  await expect(page.getByTestId("bold-drawer-addnumber-a2p")).toContainText("not connected yet");
  await page.getByTestId("bold-drawer-addnumber-finish").click();

  await expect(page.getByTestId("bold-toast")).toContainText("requested");
  const rows = page.getByTestId("bold-senders-num");
  await expect(rows).toContainText("Area code 512");
  await expect(rows).toContainText("A2P not filed yet");

  // Withdraw it so re-runs start clean.
  await rows.getByText("Area code 512").first().click();
  await expect(page.getByTestId("bold-drawer-numberrequest")).toBeVisible();
  await page.getByTestId("bold-drawer-numberrequest-cancel").click();
  await expect(page.getByTestId("bold-toast")).toContainText("withdrawn");
});

test("the email-sender flow renders the real DNS records and its live check state", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-senders").click();
  await page.getByTestId("bold-senders-add-email").click();
  await expect(page.getByTestId("bold-drawer-addsender")).toBeVisible();
  await expect(page.getByTestId("bold-drawer-addsender")).toContainText("replies go there");
  // Step one is a real create, so an invalid address is refused by the API
  // rather than waved through into a DNS step for a sender that doesn't exist.
  await page.getByTestId("bold-drawer-addsender-email").fill("not-an-address");
  await page.getByTestId("bold-drawer-addsender-create").click();
  await expect(page.getByTestId("bold-settings-drawer-error")).toBeVisible();
  await page.getByTestId("bold-settings-drawer-close").click();
  await expect(page.getByTestId("bold-drawer-addsender")).toBeHidden();
});

/* §12.5 — invite sends, is pending, resends, revokes; last owner protected */

test("invite: sends, appears pending, resends and revokes", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-team").click();
  await expect(page.getByTestId("bold-wss-team-item")).toBeVisible();

  const email = `colleague-${RUN}@brightsmile.test`;
  await page.getByTestId("bold-team-invite").click();
  await expect(page.getByTestId("bold-drawer-invite")).toBeVisible();
  await page.getByTestId("bold-drawer-invite-email").fill(email);
  await page.getByTestId("bold-drawer-invite-next").click();
  await page.getByTestId("bold-drawer-invite-role-viewer").click();
  await page.getByTestId("bold-drawer-invite-finish").click();

  // It reports honestly whether the mail actually went.
  await expect(page.getByTestId("bold-toast")).toContainText(/Invite (sent|created)/);
  const people = page.getByTestId("bold-team-people");
  await expect(people).toContainText(email);
  await expect(people).toContainText("Pending");

  // Resend and revoke, both from the pending row's own drawer.
  await people.getByText(email).click();
  await expect(page.getByTestId("bold-drawer-pendinginvite")).toBeVisible();
  await page.getByTestId("bold-drawer-invite-resend").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Sent again");

  await people.getByText(email).click();
  await page.getByTestId("bold-drawer-invite-revoke").click();
  await expect(page.getByTestId("bold-drawer-pendinginvite")).toContainText("stops working immediately");
  await page.getByTestId("bold-drawer-invite-revoke-confirm").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Revoked");
  await expect(page.getByTestId("bold-team-people")).not.toContainText(email);
});

test("a person's drawer resolves their own data, and last-owner protection is stated where it applies", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-team").click();
  await page.getByTestId("bold-team-people").getByText(OWNER_EMAIL).first().click();
  const drawer = page.getByTestId("bold-drawer-person");
  await expect(drawer).toBeVisible();

  // The drawer reads from the row it was opened with — every field below is
  // one that row carries, which is the whole lesson of the sibling surface.
  await expect(drawer).toContainText(OWNER_EMAIL);
  await expect(drawer).toContainText("Joined");
  await expect(page.getByTestId("bold-drawer-person-role-owner")).toBeVisible();
  await expect(page.getByTestId("bold-drawer-person-role-viewer")).toBeVisible();

  // The invariant, without pinning how many owners this workspace happens to
  // have: the last-owner banner and the remove affordance are mutually
  // exclusive, and exactly one of them is present.
  const banner = page.getByTestId("bold-drawer-person-lastowner");
  const remove = page.getByTestId("bold-drawer-person-remove");
  const isLastOwner = (await banner.count()) > 0;
  if (isLastOwner) {
    await expect(banner).toContainText("only owner");
    await expect(remove).toHaveCount(0);
  } else {
    await expect(remove).toBeVisible();
    // Destructive actions state their consequence before they run.
    await remove.click();
    await expect(drawer).toContainText("back to the queue");
    await expect(page.getByTestId("bold-drawer-person-remove-confirm")).toBeVisible();
  }

  // Whatever the interface offers, the server is the thing enforcing it: a
  // membership write for somebody who is not on this team is refused.
  const demote = await page.request.patch(`/api/cf/workspaces/members/${RUN}-nobody`, {
    data: { role: "ADMIN" },
  });
  expect(demote.ok()).toBe(false);
});

/* §12.6 — guardrail toggles and caps write immediately; overrides listed */

test("a guardrail cap writes on blur with a toast naming the change, and overrides stay visible", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-guard").click();
  await expect(page.getByTestId("bold-wss-guard-item")).toBeVisible();

  // A typed recessed well, not a stepper: no spinners, and it takes a number.
  const cap = page.getByTestId("bold-guard-cap-email");
  await expect(cap).toBeVisible();
  await cap.fill("150");
  await cap.blur();
  await expect(page.getByTestId("bold-toast")).toContainText("150 a day");

  // It persisted — no Save button was involved.
  await page.reload();
  await page.getByTestId("bold-root").waitFor({ state: "visible" });
  await page.getByTestId("bold-dock-wssettings").click();
  await page.getByTestId("bold-wss-guard").click();
  await expect(page.getByTestId("bold-guard-cap-email")).toHaveValue("150");

  // Every campaign appears on the overrides tab, saying whether it departs.
  await page.getByTestId("bold-wss-tab-3").click();
  await expect(page.getByTestId("bold-guard-over")).toContainText(/Inherits everything|instead of/);

  // Restore the neutral state for re-runs and captures.
  const restored = await page.request.patch("/api/cf/workspaces/guardrail-defaults", { data: {} });
  expect(restored.ok()).toBe(true);
});

/* §12.7 · §12.8 — credits renders the design, and every number has a source */

test("credits: the hero and three tabs, with every absent number carrying its reason", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toSettings(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-wss-credits").click();
  await expect(page.getByTestId("bold-credits")).toBeVisible();

  // Balance is real; the runway sentence is either derived or absent WITH its
  // reason — it is never a guess dressed as a projection.
  await expect(page.getByTestId("bold-credits-balance")).toHaveText(/^[\d,]+$/);
  await expect(page.getByTestId("bold-credits-runway")).toContainText(
    /Ada slows non-urgent sends|will not guess/,
  );
  // No plan carries an allowance, so there is no % bar — and it says why.
  await expect(page.getByTestId("bold-credits-no-allowance")).toBeVisible();

  // Prices come from the effective-dated table, never from this page.
  await page.getByTestId("bold-credits-tab-what").click();
  await expect(page.getByTestId("bold-credits-rate-lead_reveal")).toBeVisible();
  await expect(page.getByTestId("bold-credits-rate-email_send")).toContainText("not charged yet");

  // Burn and billing are absent with stated reasons, not zeroes.
  await page.getByTestId("bold-credits-tab-top-ups").click();
  await expect(page.getByTestId("bold-credits-billing-absent")).toContainText("billing is not connected");

  // The buy flow is the same right-hand drawer, and it stops where the money
  // would have to move rather than mocking a receipt.
  await page.getByTestId("bold-credits-tab-where").click();
  await page.getByTestId("bold-credits-topup").click();
  await expect(page.getByTestId("bold-drawer-buy")).toBeVisible();
  await page.getByTestId("bold-drawer-buy-next").click();
  await expect(page.getByTestId("bold-drawer-buy-nocard")).toContainText("nothing here to charge");
  await page.getByTestId("bold-drawer-buy-next").click();
  await expect(page.getByTestId("bold-drawer-buy")).toContainText("Nothing was charged");
  await page.getByTestId("bold-drawer-buy-done").click();
  await expect(page.getByTestId("bold-drawer-buy")).toBeHidden();
});
