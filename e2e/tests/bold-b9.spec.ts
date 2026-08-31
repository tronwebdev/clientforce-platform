import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

/**
 * B9 smoke — first-run onboarding + billing + the canon tour, end to end on
 * the REAL spines, in the REVISED arc (DEC-137): business → site *or*
 * tell-her → read-back → goal → audience → the one ask → [contacts, only
 * when an own-book audience is picked] → replies → done → plan.
 *
 * Two runs, because the ruled behaviour differs by audience shape:
 *  1. an OWN-BOOK pick — the contacts step EXISTS, the flow is 8 steps, the
 *     left-rail grows its matching row, and a second pick names a primary;
 *  2. a NEW-DEMAND-only pick through the TELL-HER path (typed facts, no
 *     website) — the contacts step is ABSENT and the flow renumbers to 7.
 *
 * Each run creates a genuinely new tenant, so it needs the DB to tear down —
 * against deployed staging (no DB reachable) both skip, honestly.
 */

const DB_URL = process.env.FIXTURE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const EMAIL_A = `e2e-b9-a${RUN}@fixture.test`;
const EMAIL_B = `e2e-b9-b${RUN}@fixture.test`;

const cleanup = (email: string): void => {
  execSync(`pnpm --filter @clientforce/db exec tsx prisma/b9-cleanup.ts ${email}`, {
    cwd: `${process.cwd()}/..`,
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
};

// Teardown lives in afterAll, not only an in-test finally: Playwright skips
// finally blocks when a test times out, and a leaked tenant is a lie in the DB.
test.afterAll(() => {
  if (!DB_URL) return;
  for (const email of [EMAIL_A, EMAIL_B]) {
    try {
      cleanup(email);
    } catch {
      /* nothing to clean (that run skipped before sign-in) */
    }
  }
});

/** A brand-new principal: dev-login upserts the User lazily; with no
 *  membership, /bold answers with the onboarding rather than the shell. */
async function firstRun(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await page.goto("/bold");
  await expect(page.getByTestId("bold-onboarding")).toBeVisible({ timeout: 15_000 });
}

test("own-book audience: the contacts step exists, the flow is 8 steps, a second pick names a primary", async ({ page }) => {
  test.skip(!DB_URL, "no fixture DB reachable (deployed staging) — the first-run flow needs teardown, so it runs on the local stack");
  test.setTimeout(180_000);

  try {
    await firstRun(page, EMAIL_A);

    // Step 1 — the business: name + shape + vertical in ONE bootstrap write.
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 1 OF 7");
    await page.getByTestId("bold-onb-name").fill(`Bright Smile ${RUN}`);
    await page.getByTestId("bold-onb-shape-local_business").click();
    await page.getByTestId("bold-onb-vertical-dental").click();
    await page.getByTestId("bold-onb-create").click();

    // Step 2 — the site read (the tell-her path has its own run below).
    await expect(page.getByTestId("bold-onb-site")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("bold-onb-site").fill("brightsmile.test");
    await page.getByTestId("bold-onb-read").click();

    // Step 3 — the read-back, and every fact states its SOURCE.
    await expect(page.getByTestId("bold-onb-read-next")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bold-onb-source")).toBeVisible();
    await expect(page.getByTestId("bold-onboarding")).toContainText("Read from brightsmile.test");
    // Industry rides into the core as a fact of its own.
    await expect(page.getByTestId("bold-onb-fact-row-industry")).toContainText("Dental practice");
    await page.getByTestId("bold-onb-read-next").click();

    // Step 4 — GOAL comes before audience now.
    await expect(page.getByTestId("bold-onb-goal-winback_deals")).toBeVisible();
    await expect(page.getByTestId("bold-onboarding")).not.toContainText("Who is worth chasing?");
    await page.getByTestId("bold-onb-goal-winback_deals").click();
    await page.getByTestId("bold-onb-goal-next").click();

    // Step 5 — AUDIENCE, registry-derived. winback_deals is own-book scoped
    // and caps at 2, so the new-demand options are not offered at all.
    await expect(page.getByTestId("bold-onb-audience-quiet")).toBeVisible();
    await expect(page.getByTestId("bold-onb-audience-never_bought")).toBeVisible();
    await expect(page.getByTestId("bold-onb-audience-match")).toHaveCount(0);
    await expect(page.getByTestId("bold-onboarding")).toContainText("up to 2");

    // One pick: no primary chip yet. Two: the first is primary by default.
    await page.getByTestId("bold-onb-audience-quiet").click();
    await expect(page.getByTestId("bold-onb-primary-quiet")).toHaveCount(0);
    await page.getByTestId("bold-onb-audience-never_bought").click();
    await expect(page.getByTestId("bold-onb-primary-quiet")).toHaveText("Primary");
    await expect(page.getByTestId("bold-onb-primary-never_bought")).toHaveText("Make primary");
    // The cap holds — a third own-book option does not exist to click, and
    // the describe row is shape-agnostic so it is offered.
    await expect(page.getByTestId("bold-onb-audience-describe")).toBeVisible();

    // The own-book pick GREW the flow: 8 steps now, and the rail carries the
    // contacts row that only exists when the step does.
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 5 OF 8");
    await expect(page.getByTestId("bold-onb-rail-your-contacts")).toBeVisible();
    await page.getByTestId("bold-onb-audience-next").click();

    // Step 6 — her one question, from the REAL gap report.
    await expect(page.getByTestId("bold-onb-gap-next")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 6 OF 8");
    if (await page.getByTestId("bold-onb-gap").isVisible().catch(() => false)) {
      await page.getByTestId("bold-onb-gap").fill("Two months free, no setup charge.");
    }
    await page.getByTestId("bold-onb-gap-next").click();

    // Step 7 — the CONDITIONAL contacts step, with the consent truth stated.
    await expect(page.getByTestId("bold-onb-import-next")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 7 OF 8");
    await expect(page.getByTestId("bold-onboarding")).toContainText("no consent, no sending");
    await page.getByTestId("bold-onb-import-skip").click();

    // Step 8 — replies.
    await expect(page.getByTestId("bold-onb-replyto")).toBeVisible();
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 8 OF 8");
    await page.getByTestId("bold-onb-replyto").fill(EMAIL_A);
    await page.getByTestId("bold-onb-sender-next").click();

    // Done: the draft is inert, names the primary, and says the rest are kept.
    await expect(page.getByTestId("bold-onb-draftcard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onb-draftcard")).toContainText("nothing sends until you say so");
    await expect(page.getByTestId("bold-onb-draftcard")).toContainText("1 MORE SAVED TO YOUR CORE");
    // The shared mailer address is the PLATFORM domain, never a fixture TLD.
    await expect(page.getByTestId("bold-onboarding")).toContainText("@SEND.CLIENTFORCE.IO");
    // No outside-world signal producer ships, so the closing line is absent —
    // and an own-book-only pick would not carry it in any case.
    await expect(page.getByTestId("bold-onb-signal")).toHaveCount(0);
    await page.getByTestId("bold-onb-toplan").click();

    // Plan step: tiers from GET /plans (D1), limits as READABLE numbers, and
    // the honest card-on-file deferral (no platform Stripe key — Q-118).
    await expect(page.getByTestId("bold-onb-card-deferred")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onboarding")).toContainText("nothing is charged today");
    const tierCard = page.getByTestId("bold-onb-tier-GROWTH");
    if (await tierCard.isVisible().catch(() => false)) {
      // Readable numbers, grouped — the seeded GROWTH tier is 100,000/month.
      await expect(tierCard).toContainText("100,000");
      await expect(tierCard).not.toContainText("100000 ");
      await tierCard.click();
      await page.getByTestId("bold-onb-finish").click();
    } else {
      await expect(page.getByTestId("bold-onb-plans-unavailable")).toBeVisible();
      await page.getByTestId("bold-onb-skip-plan").click();
    }

    // Hand-off: the console mounts and the canon tour fires ONCE.
    await expect(page.getByTestId("bold-root")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("bold-tour-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-tour-card")).toContainText("STEP 1 OF 8");
    await expect(page.getByTestId("bold-tour-card")).toContainText("Meet Ada");
    await page.getByTestId("bold-tour-next").click();
    await expect(page.getByTestId("bold-tour-card")).toContainText("STEP 2 OF 8");
    await page.getByTestId("bold-tour-skip").click();
    await expect(page.getByTestId("bold-tour-card")).not.toBeVisible();

    // The ? launcher now opens the getting-started drawer: done-states are
    // server-derived — the site read made `core` true only if she found
    // something, so pin the rows that cannot move instead.
    await page.getByTestId("bold-tour-btn").click();
    await expect(page.getByTestId("bold-help-drawer")).toBeVisible();
    await expect(page.getByTestId("bold-gs-campaign")).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId("bold-gs-sender")).toHaveAttribute("data-done", "false");

    // Tour-seen persists per USER: a reload still answers with the drawer.
    await page.reload();
    await expect(page.getByTestId("bold-root")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("bold-tour-btn").click();
    await expect(page.getByTestId("bold-help-drawer")).toBeVisible();
    await expect(page.getByTestId("bold-tour-card")).toHaveCount(0);
  } finally {
    try {
      cleanup(EMAIL_A);
    } catch {
      /* afterAll runs it again as the backstop */
    }
  }
});

test("tell-her path + new-demand audience: no website, real typed facts, and the flow renumbers to 7", async ({ page }) => {
  test.skip(!DB_URL, "no fixture DB reachable (deployed staging) — the first-run flow needs teardown, so it runs on the local stack");
  test.setTimeout(180_000);

  try {
    await firstRun(page, EMAIL_B);

    await page.getByTestId("bold-onb-name").fill(`Northgate Studio ${RUN}`);
    await page.getByTestId("bold-onb-shape-company").click();
    await page.getByTestId("bold-onb-vertical-saas").click();
    await page.getByTestId("bold-onb-create").click();

    // The no-website link is a real SCREEN, not a jump to fabricated facts.
    await expect(page.getByTestId("bold-onb-nosite")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("bold-onb-nosite").click();
    await expect(page.getByTestId("bold-onb-msell")).toBeVisible();
    await expect(page.getByTestId("bold-onb-mkind")).toBeVisible();
    await expect(page.getByTestId("bold-onb-marea")).toBeVisible();
    // The document affordance is present and states its own availability.
    await expect(page.getByTestId("bold-onb-doc-drop")).toBeVisible();
    // Continue REQUIRES the what-you-sell line.
    await page.getByTestId("bold-onb-tellher").click();
    await expect(page.getByTestId("bold-onb-error")).toContainText("what you sell");
    await page.getByTestId("bold-onb-msell").fill("Team seats from $18/user/mo, onboarding included");
    await page.getByTestId("bold-onb-mkind").fill("Scheduling software for clinics");
    await page.getByTestId("bold-onb-marea").fill("Nationwide, UK and Ireland");
    // There is always a way back to the site path.
    await expect(page.getByTestId("bold-onb-havesite")).toBeVisible();
    await page.getByTestId("bold-onb-tellher").click();

    // The read-back states the OTHER source, and shows the typed fact back.
    await expect(page.getByTestId("bold-onb-read-next")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bold-onboarding")).toContainText("From what you told her");
    await expect(page.getByTestId("bold-onboarding")).toContainText("Team seats from $18");
    await page.getByTestId("bold-onb-read-next").click();

    // A prospecting goal offers the new-demand options; picking only those
    // leaves the contacts step OUT, so the flow renumbers to 7.
    await page.getByTestId("bold-onb-goal-generate_leads").click();
    await page.getByTestId("bold-onb-goal-next").click();
    await expect(page.getByTestId("bold-onb-audience-match")).toBeVisible();
    await expect(page.getByTestId("bold-onb-audience-quiet")).toHaveCount(0);
    await expect(page.getByTestId("bold-onboarding")).toContainText("up to 3");
    await page.getByTestId("bold-onb-audience-match").click();
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 5 OF 7");
    await expect(page.getByTestId("bold-onb-rail-your-contacts")).toHaveCount(0);
    await page.getByTestId("bold-onb-audience-next").click();

    await expect(page.getByTestId("bold-onb-gap-next")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 6 OF 7");
    await page.getByTestId("bold-onb-gap-next").click();

    // Straight to replies — no contacts step in this arc.
    await expect(page.getByTestId("bold-onb-replyto")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onb-status")).toHaveText("STEP 7 OF 7");
    await expect(page.getByTestId("bold-onb-import-next")).toHaveCount(0);
    await page.getByTestId("bold-onb-replyto").fill(EMAIL_B);
    await page.getByTestId("bold-onb-sender-next").click();

    // A new-demand pick is exactly the case the closing signal line is FOR —
    // and it is still absent, because no outside-world producer ships
    // (Q-105/Q-106). A rendered count here would be fabricated.
    await expect(page.getByTestId("bold-onb-draftcard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-onb-signal")).toHaveCount(0);
  } finally {
    try {
      cleanup(EMAIL_B);
    } catch {
      /* afterAll runs it again as the backstop */
    }
  }
});
