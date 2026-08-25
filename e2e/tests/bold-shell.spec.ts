import { test, expect, type Page } from "@playwright/test";

/**
 * B0 smoke — the Console Bold shell behind the `consoleBold` flag.
 *
 * Two halves:
 *  1. THE GATE (runs everywhere): a workspace WITHOUT the flag must never see
 *     Bold — /bold bounces to the legacy console. demo-2 is never seeded with
 *     the flag, so this invariant holds on any deployment.
 *  2. THE FRAME (runs where the flag is on): the seed enables `consoleBold`
 *     for the demo workspace, so locally (and anywhere seeded) the shell
 *     contract is asserted at both acceptance viewports (ADDENDUM_4_BOLD §1):
 *     at 1280×720 and 924×540 — document scroll height equals viewport
 *     height, Ada bar fully visible, all 11 dock tiles visible, rail scrolls
 *     internally with its bottom card pinned. If the deployment's demo
 *     workspace has no flag yet, the frame tests skip with an annotation
 *     rather than fail — flipping the flag is the owner's launch lever.
 */

const OWNER_EMAIL = "owner@demo-agency.test";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("agents-subtitle")).toBeVisible();
}

async function switchWorkspace(page: Page, slug: string, name: string): Promise<void> {
  // The subtitle is server-rendered, so it can be visible before hydration has
  // attached the switcher's onClick — retry the open until the flyout answers.
  await expect(async () => {
    await page.getByTestId("ws-switcher").click();
    await expect(page.getByTestId(`ws-option-${slug}`)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId(`ws-option-${slug}`).click();
  await expect(page.getByTestId("ws-active-name")).toHaveText(name);
}

/** True when /bold actually mounts the Bold shell for the active workspace. */
async function boldMounts(page: Page): Promise<boolean> {
  await page.goto("/bold");
  try {
    await page.getByTestId("bold-root").waitFor({ state: "visible", timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test("flag off → /bold never mounts; the legacy console answers instead", async ({ page }) => {
  await signIn(page);
  // demo-2 is seeded WITHOUT consoleBold — the gate must bounce to legacy.
  await switchWorkspace(page, "demo-2", "Demo Workspace 2");
  await page.goto("/bold");
  await expect(page.getByTestId("agents-subtitle")).toBeVisible();
  await expect(page.getByTestId("bold-root")).toHaveCount(0);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 924, height: 540 },
]) {
  test(`B0 shell contract at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await switchWorkspace(page, "demo", "Demo Workspace");
    if (!(await boldMounts(page))) {
      test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
      return;
    }

    // 1. The page never scrolls — document scroll height equals viewport height.
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      inner: window.innerHeight,
      docW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    expect(scroll.doc).toBe(scroll.inner);
    expect(scroll.docW).toBe(scroll.innerW);

    // 2. The Ada bar is fully visible (pinned inside the canvas column).
    const ada = await page.getByTestId("bold-ada-bar").boundingBox();
    expect(ada).not.toBeNull();
    expect(ada!.y + ada!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(ada!.height).toBeGreaterThan(30);

    // 3. All 11 dock tiles visible, none clipped by the viewport.
    const tiles = page.locator("[data-dock-key]");
    await expect(tiles).toHaveCount(11);
    for (let i = 0; i < 11; i += 1) {
      const b = await tiles.nth(i).boundingBox();
      expect(b, `dock tile ${i} not rendered`).not.toBeNull();
      expect(b!.y).toBeGreaterThanOrEqual(0);
      expect(b!.y + b!.height).toBeLessThanOrEqual(viewport.height + 1);
    }

    // 4. The rail scrolls internally with its bottom card pinned: the ICP +
    //    credits card sits fully on screen while the campaign list owns any
    //    overflow (a geometry check — text-presence probes pass at 2px height,
    //    ADDENDUM_4_BOLD §7.4).
    const core = await page.getByTestId("bold-core-card").boundingBox();
    expect(core).not.toBeNull();
    expect(core!.y + core!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(core!.height).toBeGreaterThan(80);
    const camps = await page.getByTestId("bold-camps-list").evaluate((el) => ({
      scrollable: el.scrollHeight > el.clientHeight,
      client: el.clientHeight,
    }));
    expect(camps.client).toBeGreaterThan(60);
    if (viewport.height <= 540) expect(camps.scrollable).toBe(true);

    // The canvas column owns the page scroll (rule 1's other half).
    const canvasScroll = await page.getByTestId("bold-canvas-scroll").evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.overflowY;
    });
    expect(canvasScroll).toBe("auto");
  });
}

test("shell interactions: focus collapse, dock navigation, Ada panel, tour", async ({ page }) => {
  await signIn(page);
  await switchWorkspace(page, "demo", "Demo Workspace");
  if (!(await boldMounts(page))) {
    test.skip(true, "consoleBold not enabled for the demo workspace on this deployment");
    return;
  }

  // Focus mode is user-invoked only (ruling): capsule collapses the rail to
  // the icon column; the slim column click restores it.
  await page.getByTestId("bold-focus-capsule").click();
  await expect(page.getByTestId("bold-rail")).toHaveAttribute("data-open", "false");
  await page.getByTestId("bold-rail-slim").locator(".cvb-rail-slim-card").click();
  await expect(page.getByTestId("bold-rail")).toHaveAttribute("data-open", "true");

  // Dock navigation swaps the canvas surface and shows the chat-bubble tail.
  await page.getByTestId("bold-dock-contacts").click();
  await expect(page.getByTestId("bold-page-title")).toHaveText("Contacts");
  await expect(page.getByTestId("bold-canvas-tail")).toBeVisible();

  // Ada bar opens the contextual panel; chips follow the surface.
  await page.getByTestId("bold-ada-bar").click();
  await expect(page.getByTestId("bold-ada-panel")).toBeVisible();
  await expect(page.getByTestId("bold-ada-panel").getByText("Upload a CSV")).toBeVisible();
  await page.getByTestId("bold-ada-panel").getByRole("button", { name: "Close" }).click();

  // Tour scaffold: the ? launches the anchored walkthrough.
  await page.getByTestId("bold-tour-btn").click();
  await expect(page.getByTestId("bold-tour-card")).toBeVisible();
  await page.getByTestId("bold-tour-next").click();
  await expect(page.getByTestId("bold-tour-card")).toBeVisible();
});
