import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

/**
 * B9 smoke — first-run onboarding + billing + the canon tour, end to end on
 * the REAL spines: a throwaway principal signs in, walks the Business Core
 * Onboarding (workspace bootstrap with icpProfile + consoleBold, typed facts,
 * ICP, goal → first DRAFT campaign, CF-managed sender, plan choice with
 * nothing charged), lands in the Bold console where the product tour fires
 * once, and the ? launcher then answers with the getting-started drawer whose
 * done-states are server-derived.
 *
 * The flow creates a genuinely new tenant, so it needs the DB to tear it
 * down — against deployed staging (no DB reachable) it skips, honestly.
 */

const DB_URL = process.env.FIXTURE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const EMAIL = `e2e-b9-${RUN}@fixture.test`;
const BIZ = `B9 Dental ${RUN}`;

const cleanup = (): void => {
  execSync(`pnpm --filter @clientforce/db exec tsx prisma/b9-cleanup.ts ${EMAIL}`, {
    cwd: `${process.cwd()}/..`,
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
};

// Teardown lives in afterAll, not only an in-test finally: Playwright skips
// finally blocks when a test times out, and a leaked tenant is a lie in the DB.
test.afterAll(() => {
  if (!DB_URL) return;
  try {
    cleanup();
  } catch {
    /* nothing to clean (the run skipped before sign-in) */
  }
});

test("onboarding → plan → console: the whole first run on real writes", async ({ page }) => {
  test.skip(!DB_URL, "no fixture DB reachable (deployed staging) — the first-run flow needs teardown, so it runs on the local stack");
  test.setTimeout(180_000);

  try {
    // A brand-new principal: dev-login upserts the User lazily; no membership
    // exists, so /bold answers with the onboarding, not the shell.
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    await page.goto("/bold");
    await expect(page.getByTestId("bold-onboarding")).toBeVisible({ timeout: 15_000 });

    // Step 1 — the business: name + shape + vertical in ONE bootstrap write.
    await page.getByTestId("bold-onb-name").fill(BIZ);
    await page.getByTestId("bold-onb-shape-local_business").click();
    await page.getByTestId("bold-onb-vertical-dental").click();
    await page.getByTestId("bold-onb-create").click();

    // Step 2 — site: the no-website path (deterministic locally; the distill
    // worker rail has its own API spec coverage).
    await expect(page.getByTestId("bold-onb-site")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("bold-onb-nosite").click();

    // Step 3 — facts: type the offer; typed answers always win.
    await expect(page.getByTestId("bold-onb-fact-offer")).toBeVisible();
    await page.getByTestId("bold-onb-fact-offer").fill("Implant consults and whitening");
    await page.getByTestId("bold-onb-fact-offer").locator("xpath=following-sibling::span[1]").click();
    // The fact is only saved when it comes BACK from the context read.
    await expect(page.getByTestId("bold-onboarding")).toContainText("Implant consults and whitening", { timeout: 15_000 });
    await page.getByTestId("bold-onb-facts-next").click();

    // Step 4 — ICP, step 5 — goal (creates the first DRAFT campaign).
    await page.getByTestId("bold-onb-icp-match").click();
    await page.getByTestId("bold-onb-icp-next").click();
    await page.getByTestId("bold-onb-goal-book_appointments").click();
    await page.getByTestId("bold-onb-goal-next").click();

    // Step 6 — her one question, from the REAL gap report (answer if asked).
    await expect(page.getByTestId("bold-onb-gap-next")).toBeVisible({ timeout: 15_000 });
    if (await page.getByTestId("bold-onb-gap").isVisible().catch(() => false)) {
      await page.getByTestId("bold-onb-gap").fill("Weekdays 9 to 5, Saturdays until noon.");
    }
    await page.getByTestId("bold-onb-gap-next").click();

    // Step 7 — sender: the CF-managed mailer row, ready day one.
    await expect(page.getByTestId("bold-onb-replyto")).toBeVisible();
    await page.getByTestId("bold-onb-replyto").fill(EMAIL);
    await page.getByTestId("bold-onb-sender-next").click();

    // Done card: the draft is inert and says so.
    await expect(page.getByTestId("bold-onb-draftcard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onb-draftcard")).toContainText("nothing sends until you say so");
    // The shared mailer address is the PLATFORM domain, never a fixture TLD.
    await expect(page.getByTestId("bold-onboarding")).toContainText("@SEND.CLIENTFORCE.IO");
    await page.getByTestId("bold-onb-toplan").click();

    // Plan step: tiers from GET /plans (D1 — no UI constants), the honest
    // card-on-file deferral (no platform Stripe key exists — Q-118), and the
    // no-charge promise stated in words.
    await expect(page.getByTestId("bold-onb-card-deferred")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onboarding")).toContainText("nothing is charged today");
    const tierCard = page.getByTestId("bold-onb-tier-GROWTH");
    if (await tierCard.isVisible().catch(() => false)) {
      await tierCard.click();
      await page.getByTestId("bold-onb-finish").click();
    } else {
      // Unpublished tiers: the step SAYS there is nothing to choose and still
      // opens the console — an honest empty state, not a dead end.
      await expect(page.getByTestId("bold-onb-plans-unavailable")).toBeVisible();
      await page.getByTestId("bold-onb-skip-plan").click();
    }

    // Hand-off: the console mounts (consoleBold was flipped in the bootstrap)
    // and the canon tour fires ONCE — STEP 1 OF 8 without any click.
    await expect(page.getByTestId("bold-root")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("bold-tour-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-tour-card")).toContainText("STEP 1 OF 8");
    await expect(page.getByTestId("bold-tour-card")).toContainText("Meet Ada");
    await page.getByTestId("bold-tour-next").click();
    await expect(page.getByTestId("bold-tour-card")).toContainText("STEP 2 OF 8");
    await page.getByTestId("bold-tour-skip").click();
    await expect(page.getByTestId("bold-tour-card")).not.toBeVisible();

    // The ? launcher now opens the getting-started drawer: done-states are
    // server-derived — the typed fact made `core` true; the DRAFT campaign
    // and keyless sender honestly stay false.
    await page.getByTestId("bold-tour-btn").click();
    await expect(page.getByTestId("bold-help-drawer")).toBeVisible();
    await expect(page.getByTestId("bold-help-drawer")).toContainText("GETTING STARTED");
    await expect(page.getByTestId("bold-gs-core")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("bold-gs-campaign")).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId("bold-gs-sender")).toHaveAttribute("data-done", "false");

    // Replay is one tap — the drawer's button restarts the tour.
    await page.getByTestId("bold-tour-replay").click();
    await expect(page.getByTestId("bold-tour-card")).toBeVisible();
    await expect(page.getByTestId("bold-tour-card")).toContainText("STEP 1 OF 8");
    await page.getByTestId("bold-tour-skip").click();

    // Tour-seen persists per USER (not per browser): a fresh reload still
    // answers the ? with the drawer, not the tour.
    await page.reload();
    await expect(page.getByTestId("bold-root")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("bold-tour-btn").click();
    await expect(page.getByTestId("bold-help-drawer")).toBeVisible();
    await expect(page.getByTestId("bold-tour-card")).toHaveCount(0);
  } finally {
    try {
      cleanup();
    } catch {
      /* afterAll runs it again as the backstop */
    }
  }
});
