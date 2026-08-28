import { test, expect, type Page } from "@playwright/test";

/**
 * B2.5 smoke — the Bold create-campaign flow (DEC-108/DEC-109) end to end
 * against the SHIPPED create path: goal grid (incl. a DEC-109 EXTEND key) →
 * spec answer (the Q-069 goal-summary write) → CSV ingest through the shared
 * mapper (consent honesty, real chunked import) → the live gap report →
 * value + projection → channel capability (DEC-061) → the labeled mechanical
 * starter plan (deterministic — the AI planner is not required) → limits →
 * review → launch (guardrails PATCH · ACTIVE · per-contact enrollments; the
 * LH1 ladder holds fresh unverified imports, honestly tallied).
 *
 * Unique per-run emails keep re-runs deterministic; the created campaign and
 * its list are cleaned up through the shipped DELETE/PATCH at the end.
 */

const OWNER_EMAIL = "owner@demo-agency.test";

// Cleanup runs even when the test fails mid-flow (a failed run must never
// leak its uniquely-named campaign into the rail for the next run).
let createdName: string | null = null;
test.afterEach(async ({ page }) => {
  if (!createdName) return;
  try {
    const agents = (await (await page.request.get("/api/cf/agents")).json()) as Array<{ id: string; name: string }>;
    const created = agents.find((a) => a.name === createdName);
    if (created) await page.request.delete(`/api/cf/agents/${created.id}`);
    const lists = (await (await page.request.get("/api/cf/lists")).json()) as Array<{ id: string; name: string }>;
    for (const l of lists.filter((x) => x.name.startsWith("e2e-quotes-"))) {
      await page.request.patch(`/api/cf/lists/${l.id}`, { data: { archived: true } });
    }
  } catch {
    // best-effort — a dead page must not fail the suite twice
  }
  createdName = null;
});

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

test("create a campaign end to end through the shipped path, then launch", async ({ page }) => {
  test.setTimeout(120_000);
  if (!(await signInToBold(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }
  const run = Date.now();
  const specAnswer = `Quotes sent this quarter — e2e ${run}`;
  createdName = specAnswer;

  // Entry: the campaigns page's New campaign opens the in-Bold flow.
  await page.getByText("All", { exact: true }).click();
  await page.getByTestId("bold-new-campaign").click();
  await expect(page.getByTestId("bold-create")).toBeVisible();
  await expect(page.getByTestId("bold-page-title")).toHaveText("New campaign");

  // Step 0 — the goal grid carries the DEC-109 EXTEND with its value basis.
  const quotes = page.getByTestId("bold-goal-accept_quotes");
  await expect(quotes).toContainText("Get quotes accepted");
  await expect(quotes).toContainText("value per accepted quote");
  await quotes.click();
  await expect(page.getByText("Which quotes are waiting?")).toBeVisible();
  await page.getByTestId("bold-create-spec").fill(specAnswer);
  await page.getByTestId("bold-create-next").click();

  // Step 1 — sourceless audience options render coming-soon (Q-074, owner
  // copy); the CSV path runs the SHARED mapper against a synthetic file.
  await expect(page.getByTestId("bold-who-seg")).toContainText("Coming soon — Ada will keep a live segment current.");
  await expect(page.getByTestId("bold-who-find")).toContainText("Coming soon — Lead finder builds it from your best customers.");
  await page.getByTestId("bold-who-csv").click();
  const csv = [
    "Full Name,Email Address,Mobile,Opted In",
    `Quinn One,e2e-b25-${run}-1@example.test,+15550000001,yes`,
    `Quinn Two,e2e-b25-${run}-2@example.test,+15550000002,yes`,
    `Quinn Three,e2e-b25-${run}-3@example.test,,yes`,
    `Quinn Silent,e2e-b25-${run}-4@example.test,,no`,
    "Broken Row,not-an-email,,yes",
  ].join("\n");
  await page.getByTestId("bold-csv-input").setInputFiles({
    name: `e2e-quotes-${run}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const tally = page.getByTestId("bold-csv-tally");
  await expect(tally).toContainText("5 rows read");
  await expect(tally).toContainText("3 with consent");
  await expect(tally).toContainText("1 held back");
  await expect(tally).toContainText("1 invalid emails skipped");
  await expect(page.getByText("They will not be contacted — they import as contacts only.")).toBeVisible();
  await page.getByTestId("bold-csv-import").click();
  await expect(page.getByTestId("bold-csv-done")).toContainText("3 contacts enroll at launch");
  await page.getByTestId("bold-create-next").click();

  // Step 2 — the LIVE gap report (accept_quotes requires pricing + the core
  // fields); typing an answer resolves through POST /context/answers.
  await expect(page.getByTestId("bold-know-stat")).toContainText("still missing");
  const pricing = page.getByTestId("bold-gap-input-pricing");
  await expect(pricing).toBeVisible();
  await pricing.fill("Crowns from $1,400; implant quotes average $1,800");
  await pricing.press("Enter");
  await expect(page.getByTestId("bold-gap-pricing")).toContainText("Crowns from $1,400", { timeout: 10_000 });
  await page.getByTestId("bold-create-next").click();

  // Step 3 — value + the honest projection.
  await page.getByTestId("bold-value-unit").fill("1800");
  await page.getByTestId("bold-value-target").fill("3");
  await expect(page.getByTestId("bold-value-proj")).toContainText("$5,400");
  await page.getByTestId("bold-create-next").click();

  // Step 4 — real channel capability: the seeded sender enables email; SMS
  // discloses DEC-061; calls carry their wave.
  await expect(page.getByTestId("bold-chan-email")).toContainText("A connected sender is ready.");
  await expect(page.getByTestId("bold-chan-sms")).toContainText("Connect a Twilio sender first");
  await expect(page.getByTestId("bold-chan-call")).toContainText("Coming soon.");
  await page.getByTestId("bold-create-next").click();

  // Step 5 — the mechanical starter (labeled, deterministic; the one graph
  // write path stands the campaign up lazily — DEC-108).
  await page.getByTestId("bold-plan-starter").click();
  await expect(page.getByTestId("bold-plan-source")).toContainText("Ada didn't write this copy");
  const s1 = page.getByTestId("bold-plan-node-create-step-1");
  await expect(s1).toContainText("Quick question for {{company}}");
  await expect(s1).toContainText("1 CREDIT / SEND");
  await expect(page.getByTestId("bold-plan-node-create-branch-reply")).toContainText("When they reply");
  await page.getByTestId("bold-create-next").click();

  // Step 6 — limits: the literal-true rails render locked, never as toggles.
  // The autonomy radio rides this step — default "Act inside limits".
  await expect(page.getByTestId("bold-create-auto-limits")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("bold-create-auto-ask")).toContainText("Nothing sends without your tap");
  await expect(page.getByTestId("bold-guard-suppress")).toContainText("ALWAYS ON");
  await page.getByTestId("bold-create-next").click();

  // Step 7 — review reads back every decision; credits estimate = the plan's
  // per-step prices × audience (2 email steps × 1 credit × 3 people).
  await expect(page.getByTestId("bold-review-name")).toHaveValue(specAnswer);
  const review = page.getByTestId("bold-review");
  await expect(review).toContainText(specAnswer);
  await expect(review).toContainText("3 enroll at launch");
  await expect(review).toContainText("$1,800 × 3 = $5,400");
  await expect(page.getByTestId("bold-review-credits")).toContainText("~6");

  // Launch: guardrails PATCH → ACTIVE → enrollments. Fresh imports are LH1
  // `unverified`, so the gate HOLDS them — the tally says so honestly.
  await page.getByTestId("bold-create-next").click();
  await expect(page.getByTestId("bold-toast")).toContainText("Campaign live", { timeout: 30_000 });
  await expect(page.getByTestId("bold-toast")).toContainText("held for checks");

  // The launched campaign is live in the console: rail row + hero summary
  // leading with the owner's own sentence (Q-069).
  await expect(page.getByTestId("bold-page-title")).toHaveText(specAnswer);
  await expect(page.getByTestId("bold-camps-list").getByText(specAnswer)).toBeVisible();
  await expect(page.getByText(specAnswer).nth(1)).toBeVisible();

  // Cleanup happens in afterEach (runs on failure too).
});
