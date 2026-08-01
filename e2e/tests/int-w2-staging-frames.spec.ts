import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * INT W2 (DEC-103) — §8 LIVE frames from DEPLOYED STAGING, showing the booking
 * that Calendly genuinely delivered through the staging ingress.
 *
 * These are not the §8 local-stack frames: the Meeting behind every surface here
 * was written by the deployed API's own /webhooks/calendly off a REAL Calendly
 * POST, correlated by the per-lead `utm_content` rider.
 *
 * DISCIPLINE — a frame must never quietly picture the wrong screen. Capture is
 * assertion-gated: every shot asserts the specific evidence it claims to show
 * (the booked card carrying the lead's name, the timeline row, the live Calendly
 * card) BEFORE the screenshot is taken, so a mis-navigation fails the run rather
 * than producing a plausible-looking but worthless image.
 *
 * Env:
 *   E2E_BASE_URL      deployed staging web FQDN (set by the workflow)
 *   FRAME_LEAD_NAME   the correlated lead shown on the booked card
 *   FRAME_OUT_DIR     where the PNGs land (default docs/fidelity/int-w2/live)
 */
const OWNER_EMAIL = process.env.FRAME_OWNER_EMAIL ?? "owner@demo-agency.test";
const LEAD_NAME = process.env.FRAME_LEAD_NAME ?? "Mike Mackillip";
const OUT = process.env.FRAME_OUT_DIR ?? "../docs/fidelity/int-w2/live";

test.use({ viewport: { width: 1440, height: 900 } });

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("agents-subtitle")).toBeVisible();
}

/** The agent whose pipeline carries the booked lead. */
async function openFirstAgent(page: Page, tab: string): Promise<void> {
  await page.goto("/agents");
  const row = page.getByTestId("agent-row").first();
  const fallback = page.getByRole("link", { name: /.+/ });
  if (await row.count()) {
    await row.click();
  } else {
    // The table markup varies by build; fall back to the first /agents/ link.
    await fallback.filter({ hasText: /./ }).first().click();
  }
  await page.waitForURL(/\/agents\/[^/]+\//);
  const url = new URL(page.url());
  const agentId = url.pathname.split("/")[2];
  await page.goto(`/agents/${agentId}/${tab}`);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test("pipeline board shows the genuinely delivered booking", async ({ page }) => {
  await signIn(page);
  await openFirstAgent(page, "pipeline");

  const board = page.getByTestId("pipeline-board");
  await expect(board).toBeVisible();
  // The load-bearing assertion: the BOOKED column must carry the correlated
  // lead. Without this the screenshot could be of an empty board and still pass.
  const bookedCol = page.getByTestId("pipeline-col-booked");
  await expect(bookedCol).toBeVisible();
  await expect(bookedCol.getByTestId("pipeline-card").filter({ hasText: LEAD_NAME })).toBeVisible();

  await page.screenshot({ path: `${OUT}/live-pipeline-booked-card.png` });
});

test("contact drawer timeline carries the calendar record + stage change", async ({ page }) => {
  await signIn(page);
  // The timeline lives on the CONTACTS drawer (ContactsView), not the agent
  // Leads tab — the first dry run failed here, which is exactly what an
  // assertion-gated capture is for.
  await page.goto("/contacts");

  const row = page.getByTestId("contact-row").filter({ hasText: LEAD_NAME }).first();
  await expect(row).toBeVisible();
  await row.click();

  const drawer = page.getByTestId("contact-drawer");
  await expect(drawer).toBeVisible();
  const timeline = page.getByTestId("drawer-timeline");
  await expect(timeline).toBeVisible();
  // Prove the drawer is showing booking history, not an empty shell.
  await expect(page.getByTestId("drawer-timeline-empty")).toHaveCount(0);
  await expect(timeline).toContainText(/booked|meeting/i);

  await page.screenshot({ path: `${OUT}/live-contact-drawer-timeline.png` });
});

test("integrations grid + drawer show Calendly detection live", async ({ page }) => {
  await signIn(page);
  await page.goto("/integrations");

  const card = page.getByText("Calendly", { exact: false }).first();
  await expect(card).toBeVisible();
  await page.screenshot({ path: `${OUT}/live-integrations-calendly.png` });

  await card.click();
  const drawer = page.getByTestId("integration-drawer");
  await expect(drawer).toBeVisible();
  // The detection row is the whole point of the token tier — assert it before
  // framing it, so a link-tier-only drawer cannot pose as booking detection.
  await expect(page.getByTestId("calendly-detection")).toBeVisible();

  await page.screenshot({ path: `${OUT}/live-calendly-drawer-detection.png` });
});
