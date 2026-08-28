import { test, expect, type Page } from "@playwright/test";

/**
 * B4 smoke — the Site agent surface on the real widget spine + the
 * Receptionist pitch panel. The site agent reads the seeded demo widget
 * (installed truth, live counts), its controls write real rows (the
 * DEC-120(2) consent-ask toggle round-trips and restores OFF), and the
 * embed snippet carries the real public credential. The receptionist
 * opens as the prototype's slide-over in its one true state — not owned,
 * with the add action visibly deferred.
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

test("the site agent page reads the real widget: strip, card, controls, snippet", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-dock-chatbot").click();
  await expect(page.getByTestId("bold-siteagent")).toBeVisible();
  // The seeded demo widget exists — the installed strip, never the banner.
  await expect(page.getByTestId("bold-siteagent-strip")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("bold-siteagent-strip")).toContainText(/conversation/);
  await expect(page.getByTestId("bold-siteagent-card")).toContainText("Bright Smile");

  // The rail's ALWAYS ON row carries the same truth (the one-flag rule).
  await expect(page.getByTestId("bold-alwayson-siteagent")).toContainText(/chats · \d+ booked/);

  // The consent-ask toggle (DEC-120(2)) round-trips and restores OFF.
  const consent = page.getByTestId("bold-siteagent-consentask");
  await expect(consent).toBeVisible();
  if ((await consent.getAttribute("aria-checked")) === "true") {
    await consent.click();
    await expect(consent).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
  }
  await consent.click();
  await expect(consent).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
  await expect(page.getByTestId("bold-toast")).toContainText("Consent ask on");
  await consent.click();
  await expect(consent).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });

  // A servable flow toggle round-trips too.
  const flow = page.getByTestId("bold-siteagent-flow-askQuestion");
  const wasOn = (await flow.getAttribute("aria-checked")) === "true";
  await flow.click();
  await expect(flow).toHaveAttribute("aria-checked", String(!wasOn), { timeout: 10_000 });
  await flow.click();
  await expect(flow).toHaveAttribute("aria-checked", String(wasOn), { timeout: 10_000 });

  // The embed snippet carries the REAL public credential.
  await expect(page.getByTestId("bold-siteagent-embed")).toContainText("wgt_");
});

test("the receptionist opens as the pitch slide-over — not owned, honestly deferred", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  if (!(await toBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  await page.getByTestId("bold-dock-rcp").click();
  const panel = page.getByTestId("bold-rcp");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).toContainText("Your line,");
  await expect(panel).toContainText("once she is on");
  await expect(page.getByTestId("bold-rcp-deferred")).toContainText("coming soon");
  await expect(panel).toContainText("Discloses it");
  await page.getByTestId("bold-rcp-close").click();
  await expect(panel).toHaveCount(0);

  // The rail row is the same pitch — and opens the same panel.
  await page.getByTestId("bold-alwayson-receptionist").click();
  await expect(page.getByTestId("bold-rcp")).toBeVisible();
  await page.getByTestId("bold-rcp-close").click();
});
