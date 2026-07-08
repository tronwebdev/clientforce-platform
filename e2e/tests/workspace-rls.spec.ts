import { test, expect, type Page } from "@playwright/test";

/**
 * T8 smoke — proves the APP_DATABASE_URL non-superuser RLS path end-to-end in a
 * real browser: a single OWNER, two seeded workspaces, distinct contacts (3 vs
 * 1). Switching workspace must re-scope the contacts list, which can only happen
 * if the API reads through the RLS-subject app client with the active
 * `workspace_id` GUC. If RLS were bypassed (owner client), both lists would be
 * identical and the counts below would fail.
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

  // Workspace A (demo): 3 distinct contacts.
  await switchWorkspace(page, "demo", "Demo Workspace");
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row")).toHaveCount(3);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toHaveCount(0);

  // Workspace B (demo-2): exactly 1 contact, with zero overlap — the RLS proof.
  await switchWorkspace(page, "demo-2", "Demo Workspace 2");
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row")).toHaveCount(1);
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
});
