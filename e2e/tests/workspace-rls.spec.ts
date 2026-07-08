import { test, expect, type Page } from "@playwright/test";

/**
 * T8 smoke — proves the APP_DATABASE_URL non-superuser RLS path end-to-end in a
 * real browser: a single OWNER, two seeded workspaces, disjoint SENTINEL
 * contacts (Ada only in demo, Grace only in demo-2). Switching workspace must
 * re-scope the contacts list, which can only happen if the API reads through
 * the RLS-subject app client with the active `workspace_id` GUC. If RLS were
 * bypassed (owner client), both sentinels would appear in both lists.
 *
 * Seeded by packages/db/prisma/seed.ts:
 *   demo   → Ada Lovelace, Alan Turing, Edsger Dijkstra   (3)
 *   demo-2 → Grace Hopper                                  (1)
 */

const OWNER_EMAIL = "owner@demo-agency.test";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  // C2.1 landed the shell on /agents (handoff §C) — the pre-C2.1 "Welcome
  // back" dashboard assertion made this spec red on every deploy since
  // PR #33 (same stale-assertion family as the old smoke, fixed in #41).
  await expect(page.getByTestId("agents-subtitle")).toBeVisible();
}

/** Switch the active workspace via the sidebar and wait for the re-render. */
async function switchWorkspace(page: Page, slug: string, name: string): Promise<void> {
  await page.getByTestId("ws-switcher").click();
  await page.getByTestId(`ws-option-${slug}`).click();
  await expect(page.getByTestId("ws-active-name")).toHaveText(name);
}

test("workspace switch re-scopes contacts through the RLS app path", async ({ page }) => {
  await signIn(page);

  // The RLS proof is SENTINEL DISJOINTNESS, not absolute counts: staging's
  // demo workspace is a WORKING workspace (live usage adds contacts), so an
  // exact-count assertion can never hold there — the C2.8 deploy went red on
  // "expected 3, received 10" for exactly that reason (same brittle-assertion
  // disease as the pre-C2.1 smoke, DEC-051). The seeded sentinels are stable:
  // Ada lives ONLY in demo, Grace ONLY in demo-2 — if RLS were bypassed
  // (owner client), both would appear in both lists. Pagination note: rows
  // sort createdAt-asc and both sentinels are among the earliest rows ever
  // seeded, so a leaked sentinel would land on page 1 — the absence checks
  // cannot be fooled by later pages.
  await switchWorkspace(page, "demo", "Demo Workspace");
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row").first()).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toHaveCount(0);

  await switchWorkspace(page, "demo-2", "Demo Workspace 2");
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row").first()).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
});
