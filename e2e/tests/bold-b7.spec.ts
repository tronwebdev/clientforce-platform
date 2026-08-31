import { test, expect, type Page } from "@playwright/test";

/**
 * B7 smoke — Settings & Business core as one surface + the credits view + the
 * campaign Settings tab's returned sections, all on real reads.
 *
 * B7.5 rebuilt these surfaces' WRITE layer, so the assertions that pinned B7's
 * read-only shape (the deferred-invite panel, the guardrails Save button, the
 * deferred top-up panel) moved with it. What this file keeps is B7's own
 * contract: the hub's counts are queried, the item pages are live, and the
 * campaign Settings tab round-trips its rider. The write layer's own criteria
 * are in `bold-b75.spec.ts`.
 *
 * The original intent, unchanged:
 *  - the hub's six cards carry queried counts (facts/gaps, senders, people,
 *    balance) — never the prototype's fixture numbers;
 *  - Business core lists real workspace facts; Team lists the real
 *    memberships with the real role enum;
 *  - the workspace guardrail DEFAULTS round-trip through typed wells
 *    (Q-081 — steppers retired) and never touch a live campaign;
 *  - credits: real balance, the seeded lead_reveal price on the rates tab,
 *    top-ups visibly deferred;
 *  - campaign Settings: a channel toggle round-trips the guardrails rider.
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

test("the settings hub reads real counts; Business core, Team and Guardrails are live", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  await page.getByTestId("bold-dock-wssettings").click();
  await expect(page.getByTestId("bold-wssettings")).toBeVisible();

  // Six cards, queried sublines — the Business core card counts real facts.
  await expect(page.getByTestId("bold-wss-core")).toContainText(/\d+ facts she quotes from/);
  await expect(page.getByTestId("bold-wss-team")).toContainText(/\d+ (person|people) plus Ada/);
  await expect(page.getByTestId("bold-wss-credits")).toContainText(/[\d,]+ left/);

  // Business core item: the real workspace layer. Which FIELDS exist varies
  // by environment (staging's demo BusinessContext predates the seed's
  // skip-if-present block), so assert the structure and whichever honest
  // state the data is in — a fact row with its provenance chip, or the
  // empty line (the #137 posture: pin the contract, not the fixture).
  await page.getByTestId("bold-wss-core").click();
  await expect(page.getByTestId("bold-wss-core-item")).toBeVisible();
  await expect(page.getByText("Where it comes from")).toBeVisible();
  const fact = page.getByText("You told her").first();
  const taught = page.getByText("You taught her").first();
  const core = page.getByText("Core", { exact: true }).first();
  const noFacts = page.getByText("She knows nothing yet", { exact: false });
  await expect(fact.or(taught).or(core).or(noFacts).first()).toBeVisible();
  await page.getByTestId("bold-wss-back").click();

  // Team: the real memberships (the demo owner) + the real role enum word.
  await page.getByTestId("bold-wss-team").click();
  await expect(page.getByTestId("bold-wss-team-item")).toBeVisible();
  await expect(page.getByText(OWNER_EMAIL).first()).toBeVisible();
  // Ada is a row on this page, not a feature mentioned elsewhere.
  await expect(page.getByTestId("bold-team-people")).toContainText("acts inside your guardrails");
  await page.getByTestId("bold-wss-back").click();

  // Guardrail defaults: typed wells (Q-081) round-trip; live campaigns listed.
  await page.getByTestId("bold-wss-guard").click();
  await expect(page.getByTestId("bold-wss-guard-item")).toBeVisible();
  await page.getByTestId("bold-guard-cap-email").fill("150");
  await page.getByTestId("bold-guard-cap-email").blur();
  await expect(page.getByTestId("bold-toast")).toContainText("150 a day");
  await page.reload();
  await page.getByTestId("bold-root").waitFor({ state: "visible" });
  await page.getByTestId("bold-dock-wssettings").click();
  await page.getByTestId("bold-wss-guard").click();
  await expect(page.getByTestId("bold-guard-cap-email")).toHaveValue("150");
  // The overrides tab lists the live campaigns with their OWN values.
  await page.getByTestId("bold-wss-tab-3").click();
  await expect(page.getByTestId("bold-guard-over")).toContainText("Whitening kit push");

  // Restore: clear the defaults so re-runs (and fidelity captures) start
  // from the neutral state — the write above already proved persistence.
  const restored = await page.request.patch("/api/cf/workspaces/guardrail-defaults", { data: {} });
  expect(restored.ok()).toBe(true);
});

test("credits: real balance, data-driven rates, top-ups visibly deferred over the real ledger", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  await page.getByTestId("bold-dock-wssettings").click();
  await page.getByTestId("bold-wss-credits").click();
  await expect(page.getByTestId("bold-credits")).toBeVisible();
  await expect(page.getByTestId("bold-credits-balance")).toHaveText(/^[\d,]+$/);
  // Rates come from the effective-dated CreditPrice table (lead_reveal seeded at 1).
  await page.getByTestId("bold-credits-tab-what").click();
  await expect(page.getByTestId("bold-credits-rate-lead_reveal")).toContainText("1");
  // Top-ups: billing deferred honestly, the ledger below it is real.
  await page.getByTestId("bold-credits-tab-top-ups").click();
  await expect(page.getByTestId("bold-credits-billing-absent")).toContainText("billing is not connected");
});

test("campaign Settings: the returned sections — a channel toggle round-trips the rider", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled");
    return;
  }
  // A campaign the other specs leave alone.
  await page.getByTestId("bold-camps-list").getByText("Review asks").click();
  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByTestId("bold-settings")).toBeVisible();

  // The guardrails read must land first — before it, every control is a
  // silent no-op (the b3d posture): a checked radio proves the load.
  await expect(page.getByTestId("bold-auto-limits")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });

  // Restore-first: force SMS ON through the toggle if a prior run left it off.
  const sms = page.getByTestId("bold-ch-sms");
  await expect(sms).toBeVisible();
  if ((await sms.getAttribute("aria-checked")) === "false") {
    await sms.click();
    await expect(sms).toHaveAttribute("aria-checked", "true");
  }

  // Off → persists across a reload → back on (restore).
  await sms.click();
  await expect(page.getByTestId("bold-toast")).toContainText("SMS paused");
  await page.reload();
  await page.getByTestId("bold-root").waitFor({ state: "visible" });
  await page.getByTestId("bold-camps-list").getByText("Review asks").click();
  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByTestId("bold-auto-limits")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  await expect(page.getByTestId("bold-ch-sms")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("bold-ch-sms").click();
  await expect(page.getByTestId("bold-ch-sms")).toHaveAttribute("aria-checked", "true");

  // The caps are typed wells (Q-081), and the voice cards read live derivations.
  await expect(page.getByTestId("bold-gr-cap-email")).toBeVisible();
  await expect(page.getByTestId("bold-voice-arc")).not.toContainText("—");
  await expect(page.getByTestId("bold-voice-notify")).toContainText("coming");
});
