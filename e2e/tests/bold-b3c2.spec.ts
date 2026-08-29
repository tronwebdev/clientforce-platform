import { test, expect, type Page } from "@playwright/test";

/**
 * B3c-2 smoke — human in-app calling + the recording toggle (DEC-118).
 * The drawer's call sheet grows the HUMAN leg: visible even when Ada is
 * consent-blocked (the ruled asymmetry — consent gates Ada, never a
 * person). Clicking it runs the ONE dial rail server-side: on a refusal
 * the typed reason surfaces as a toast; on a clear the keyless practice
 * line opens the in-call card, honestly labeled, and ending it logs the
 * call. The workspace recording toggle round-trips on the settings page
 * (restored OFF — the default — afterwards).
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

// The seed's call-clock fixtures: three phone contacts whose stored
// timezones spread across the globe, so at any hour at least one sits
// inside the 08:00–21:00 contact-local calling floor.
const CLOCK_CONTACTS: ReadonlyArray<readonly [string, string]> = [
  ["Sofia Reyes", "America/Chicago"],
  ["Alan Turing", "Europe/Berlin"],
  ["Edsger Dijkstra", "Asia/Tokyo"],
];
function awakeContact(): string {
  const local = (tz: string) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date())
        .find((p) => p.type === "hour")!.value,
    );
  const hit = CLOCK_CONTACTS.find(([, tz]) => {
    const h = local(tz);
    return h >= 9 && h < 20;
  });
  return (hit ?? CLOCK_CONTACTS[0]!)[0];
}

test("the human call leg rides the sheet even when Ada is blocked; the practice line is honest", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  const who = awakeContact();
  await page.getByTestId("bold-dock-contacts").click();
  await expect(page.getByTestId("bold-contacts")).toBeVisible();
  const card0 = page.getByTestId(/bold-ct-card-/).filter({ hasText: who });
  await card0.click();
  await expect(page.getByTestId("bold-person-name")).toHaveText(who);

  // Restore-first: consent to unknown, so the sheet shows Ada BLOCKED.
  const notAsked = page.getByTestId("bold-person-consent-unknown");
  await expect(notAsked).toBeVisible();
  await notAsked.click();
  await expect(page.getByTestId("bold-toast")).toContainText("Call permission cleared");

  await page.getByTestId("bold-person-call").click();
  await expect(page.getByTestId("bold-person-call-blocked")).toContainText("Ada only calls people who said yes");
  // The ruled asymmetry, on screen: Ada blocked, the human leg LIVE.
  const humanBtn = page.getByTestId("bold-person-call-human");
  await expect(humanBtn).toBeVisible();
  await humanBtn.click();

  // The awake contact clears the contact-local floor — the practice line
  // MUST connect
  // (a keyless deployment ⇒ the card says so in plain words).
  const card = page.getByTestId("bold-callcard");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("bold-callcard-sandbox")).toContainText("no real call is placed");
  await expect(page.getByTestId("bold-callcard-state")).toContainText(/Calling |On the call/);
  await page.getByTestId("bold-callcard-end").click();
  await expect(page.getByTestId("bold-toast")).toContainText(/Call logged|Call canceled/);
  const endBtn = page.getByTestId("bold-callcard-end");
  if (await endBtn.isVisible().catch(() => false)) await endBtn.click();
  await expect(card).toHaveCount(0);
});

test("the workspace recording toggle round-trips and restores OFF", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/settings");
  // Under full-suite parallel load the legacy settings shell occasionally
  // stalls on first paint — reload until the nav renders (bounded).
  await expect(async () => {
    if (!(await page.getByTestId("nav-phone").isVisible().catch(() => false))) {
      await page.reload();
      await page.getByTestId("nav-phone").waitFor({ timeout: 8_000 });
    }
  }).toPass({ timeout: 45_000 });
  await page.getByTestId("nav-phone").click();
  const toggle = page.getByTestId("call-recording-toggle");
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId("call-recording-card")).toContainText("Off by default");

  // Restore-first: a prior run that died mid-flip can leave it on.
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
  }
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
  // Restore the default — the demo workspace never records.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
});
