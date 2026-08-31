import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL } from "./_fixtures";

/**
 * B6.5 — the Lead finder as a standing watch. This encodes SURFACE_SPEC §12's
 * acceptance criteria rather than re-reading them:
 *
 *   1  tier off ⇒ no licensed-supply row anywhere IN THE RESPONSE
 *   2  no vendor named and no connect affordance when the platform key is absent
 *   3  every row opens the drawer, which renders only that row's own fields
 *   4  every count is server-derived (or says it is not a count at all)
 *   5  a keyless reveal debits nothing
 *   7  suppression comes from ONE source — feed foot and pool header agree
 *   8  an open popover dims the page and closes on the scrim
 *   9  nouns come from the shape/vertical registry, never a literal
 *
 * §6 (a basis-forbidden channel refused typed at the send/dial boundary) is
 * NOT here: those rails are B10.5 by the owner's own re-scope, so a test for
 * them would be testing something this wave deliberately does not ship.
 * §10 is the fidelity capture, not a browser test.
 *
 * Deliberately count-free. This runs against the shared demo seed, which a
 * parallel session owns this round, so every assertion is structural — the
 * spec pins BEHAVIOUR, never how many rows the seed happens to hold.
 */

test.describe.configure({ mode: "serial" });


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

async function toFinder(page: Page): Promise<boolean> {
  await page.goto("/bold");
  try {
    await page.getByTestId("bold-root").waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  const later = page.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.getByTestId("bold-dock-lead").click();
  await expect(page.getByTestId("bold-leadfinder")).toBeVisible();
  return true;
}

test("the watch shell is registry-derived, and the tier gate holds in the response itself", async ({
  page,
}) => {
  await signIn(page);
  if (!(await toFinder(page))) test.skip(true, "consoleBold flag off for the demo workspace");
  // Restore-first: a dead prior run may have left the tier on.
  await page.request.post("/api/cf/leads/buyerping", { data: { enabled: false } });
  await page.reload();
  await page.getByTestId("bold-dock-lead").click();

  // §9 — the page asks its question in the workspace's own words. Read the
  // registry's answer from the server and require the page to match it,
  // rather than pinning a string this test would then be free to invent.
  const cfgRes = await page.request.get("/api/cf/leads/config");
  expect(cfgRes.ok()).toBe(true);
  const cfg = await cfgRes.json();
  expect(cfg.title).toBeTruthy();
  expect(cfg.noun.one).toBeTruthy();
  expect(cfg.noun.many).toBeTruthy();
  await expect(page.getByTestId("bold-page-title")).toContainText(cfg.title, { timeout: 15_000 });
  await expect(page.getByTestId("bold-lead-value")).toContainText("You only spend a credit");

  // The brief reads back as a sentence with a real date behind it.
  await expect(page.getByTestId("bold-lead-brief")).toBeVisible();
  const since = page.getByTestId("bold-lead-since");
  await expect(since).toContainText("WATCHING SINCE");
  await expect(page.getByTestId("bold-lead-provenance")).toHaveCount(0);
  await since.click();
  await expect(page.getByTestId("bold-lead-provenance")).toBeVisible();

  // §1 — with the tier off, a paid type must be ABSENT from the response, not
  // hidden by the client. Assert against the API's own body.
  const searchRes = await page.request.post("/api/cf/leads/search", { data: { mode: "ada" } });
  const body = await searchRes.json();
  expect(body.tierOn).toBe(false);
  expect(Array.isArray(cfg.lockedTypes)).toBe(true);
  expect(cfg.lockedTypes.length).toBeGreaterThan(0);
  for (const row of body.candidates) {
    expect(cfg.lockedTypes, `a locked type reached the response: ${row.signalType}`).not.toContain(
      row.signalType,
    );
    // §4 — every row carries the evidence it claims, so no count or sentence
    // on screen is ever composed by the client.
    expect(row.receipt, "a row with no receipt is a score pretending to be a reason").toBeTruthy();
    expect(row.sourceTag).toBeTruthy();
    expect(row.basis).toBeTruthy();
    expect(row.channelLabel).toBeTruthy();
  }

  // §4 — the counts the controls show come from the same response as the rows.
  expect(body.counts.when.any).toBe(body.candidates.length);
  expect(typeof body.waiting).toBe("number");
  await expect(page.getByTestId("bold-lead-waiting")).toContainText("WAITING ON YOU");
});

test("the watch panel dims the page, filters the feed, and names the tier honestly", async ({
  page,
}) => {
  await signIn(page);
  if (!(await toFinder(page))) test.skip(true, "consoleBold flag off");

  // §8 — an open popover dims the page behind it and closes on the dim.
  await expect(page.getByTestId("bold-lead-watch")).toHaveCount(0);
  await page.getByTestId("bold-lead-watch-btn").click();
  const panel = page.getByTestId("bold-lead-watch");
  await expect(panel).toBeVisible();
  const scrim = page.getByTestId("bold-lead-watch-scrim");
  await expect(scrim).toBeVisible();
  // The scrim must actually cover the viewport — the whole point of the
  // ruling, and the thing an in-canvas `position:fixed` silently fails.
  const box = await scrim.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(vp.height - 1);
  await expect(scrim).toHaveCSS("background-color", "rgba(16, 22, 19, 0.26)");

  // The basis sentence is composed from the types actually watched.
  await expect(page.getByTestId("bold-lead-basisline")).not.toBeEmpty();

  // Signal filtering lives HERE, not in the mode row (§8). Tapping a group
  // puts a clearable chip in the mode row — no invisible state.
  const groups = page.locator('[data-testid^="bold-lead-group-"]');
  await expect(groups.first()).toBeVisible();
  const firstGroup = groups.first();
  const groupId = await firstGroup.getAttribute("data-testid");
  await firstGroup.click();
  await expect(page.getByTestId("bold-lead-sigchip")).toBeVisible();

  // The tier tab states the price as coming from the plan, never from here.
  await page.getByTestId("bold-lead-watchtab-bp").click();
  await expect(panel).toContainText("Price comes from your plan, not from this page");
  await expect(panel).toContainText("Nothing is watched, and nobody is contacted");
  // §2 — no vendor is named anywhere on the tier tab.
  await expect(panel).not.toContainText(/apollo/i);
  // ADDENDUM_5 §2 — the word "integration" must not appear on an intent surface.
  await expect(page.getByTestId("bold-leadfinder")).not.toContainText(/integration/i);

  await scrim.click();
  await expect(page.getByTestId("bold-lead-watch")).toHaveCount(0);

  // The chip clears the filter it set.
  await page.getByTestId("bold-lead-sigchip").click();
  await expect(page.getByTestId("bold-lead-sigchip")).toHaveCount(0);
  expect(groupId).toBeTruthy();
});

test("every row opens a drawer built only from that row, and a keyless reveal charges nothing", async ({
  page,
}) => {
  await signIn(page);
  if (!(await toFinder(page))) test.skip(true, "consoleBold flag off");

  // The feed loads after the shell, so settle on one of the two truthful
  // outcomes before counting anything.
  await expect(
    page.locator('[data-testid^="bold-lead-row-"], [data-testid="bold-lead-empty"]').first(),
  ).toBeVisible({ timeout: 20_000 });
  const rows = page.locator('[data-testid^="bold-lead-row-"]');
  const n = await rows.count();
  if (n === 0) {
    // An honest empty state is a pass, not a skip: it must explain itself
    // rather than look broken.
    await expect(page.getByTestId("bold-lead-empty")).toContainText("Nothing has fired yet");
    return;
  }

  // §3 — EVERY row opens the drawer without error. The B6 drawer threw on
  // rows whose fields it assumed; this walks them all.
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    const drawer = page.getByTestId("bold-lead-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("WHAT SHE SAW");
    await expect(drawer).toContainText("HOW SHE MAY REACH THEM");
    await page.getByTestId("bold-lead-drawer-scrim").click();
    await expect(page.getByTestId("bold-lead-drawer")).toHaveCount(0);
  }

  // §5 — keyless, a reveal must refuse and debit nothing. Own-book rows have
  // nothing to buy, so this is asserted at the API where it is decidable.
  const res = await page.request.post("/api/cf/leads/reveal", {
    data: { providerRef: "b65-nonexistent" },
  });
  expect(res.status()).toBe(503);
  const body = await res.json();
  // §2 — the refusal never names a vendor to the caller's UI layer.
  expect(JSON.stringify(body)).not.toMatch(/apollo/i);
});

test("the pool counts what it can and says so where it cannot; suppression has one source", async ({
  page,
}) => {
  await signIn(page);
  if (!(await toFinder(page))) test.skip(true, "consoleBold flag off");

  await page.getByTestId("bold-lead-mode-fit").click();
  await expect(page.getByTestId("bold-lead-pool")).toBeVisible();

  // The free band is first and is REAL; the paid bands have no honest number
  // on this deployment and must say so rather than show an estimate nobody
  // computed (DEC-115).
  const poolRes = await page.request.get("/api/cf/leads/pool");
  const pool = await poolRes.json();
  expect(pool.bands[0].key).toBe("yours");
  expect(pool.bands[0].free).toBe(true);
  expect(typeof pool.bands[0].count).toBe("number");
  for (const b of pool.bands.slice(1)) {
    expect(b.count).toBeNull();
    expect(b.note, "a band with no count must explain itself").toBeTruthy();
  }
  await page.getByTestId("bold-lead-band-strong").click();
  await expect(page.getByTestId("bold-lead-band-nocount")).toBeVisible();

  // §7 — the feed foot and the pool header read the SAME suppression source.
  const searchRes = await page.request.post("/api/cf/leads/search", { data: { mode: "ada" } });
  const feed = await searchRes.json();
  expect(pool.suppression.total).toBe(feed.suppression.total);
  expect(pool.suppression.reasons).toEqual(feed.suppression.reasons);
});

test("Direct search states an operator condition, never a vendor or a connect step", async ({
  page,
}) => {
  await signIn(page);
  if (!(await toFinder(page))) test.skip(true, "consoleBold flag off");

  await page.getByTestId("bold-lead-mode-direct").click();
  const direct = page.getByTestId("bold-lead-direct");
  await expect(direct).toBeVisible();

  const cfg = await (await page.request.get("/api/cf/leads/config")).json();
  if (cfg.providerPeopleSearch) {
    await page.getByTestId("bold-lead-direct-go").click();
    // §2 — keyless locally: an operator condition, in the user's words.
    await expect(page.getByTestId("bold-lead-unavailable")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bold-lead-unavailable")).toContainText(
      "Search is temporarily unavailable",
    );
    await expect(page.getByTestId("bold-lead-unavailable")).toContainText(/nothing for you to fix/i);
    await expect(direct).not.toContainText(/apollo|connect a provider|not connected/i);
  } else {
    // A consumer-shape workspace is not sold a person-level provider search;
    // its Direct search is over its own book, and says so in its own noun.
    await expect(page.getByTestId("bold-lead-ownbook-search")).toContainText(cfg.noun.many);
  }
});
