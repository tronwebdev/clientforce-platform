/**
 * Bold fidelity capture — the ONE way §8 evidence frames get made (B1 review
 * ruling: a frame that can silently be stale or crashed isn't evidence).
 *
 * Guarantees:
 *  - SINGLE run, all frames, against one running build. Frames land in a
 *    staging dir; docs/fidelity/<unit>/ is only touched when EVERY frame
 *    captured cleanly — no partial or mixed-provenance sets.
 *  - Any client-side `pageerror`, any Next error-boundary text, or any
 *    missing/failed frame ABORTS the whole run. Nothing is promoted.
 *  - Writes MANIFEST.json beside the frames: unit, git commit (+dirty flag),
 *    capture timestamp, base URL, and per-frame viewport + byte size +
 *    sha256. `pnpm lint:fidelity` fails if committed bytes ever diverge from
 *    the manifest, so a stale or substituted frame breaks the build instead
 *    of impersonating evidence. Reviewers verify what they are looking at by
 *    hashing the file — never by trusting an image cache.
 *
 * Usage:  node e2e/capture-bold-fidelity.mjs [unit]     (b1 | b2 | b25 | b26 | b3 | b3b | b3c1 | b3c2 | b3d | b4; default b1)
 * Env:    CAPTURE_BASE_URL (default http://localhost:3000)
 *         PLAYWRIGHT_CHROMIUM_EXECUTABLE (a pre-provisioned Chromium)
 *
 * Note: the b1 set is the B1-review frame list verbatim — its
 * `build-tab-stub` frame documented the pre-B2 stub and is historical once
 * B2 lands (re-running unit b1 would show the live pipeline there).
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = process.argv[2] ?? "b1";
if (!["b1", "b2", "b25", "b26", "b3", "b3b", "b3c1", "b3c2", "b3d", "b4", "b45"].includes(UNIT)) {
  console.error(`Unknown unit "${UNIT}" — this tool knows b1, b2, b25, b26, b3, b3b, b3c1, b3c2, b3d, b4 and b45.`);
  process.exit(1);
}
const OUT = join(ROOT, "docs", "fidelity", UNIT);
const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const PROTO = `file://${join(ROOT, "design_handoff_console_v3", "prototypes", "Console Bold.dc.html").replace(/ /g, "%20")}`;
// B4.5: the live-call card's pixel truth is the OLD console's rcpCallOpen
// treatment (owner ruling at the B4 addendum) — a different prototype file.
const PROTO_LEGACY = `file://${join(ROOT, "design_handoff_console_v3", "prototypes", "legacy", "Clientforce Console.dc.html").replace(/ /g, "%20")}`;
const FONTS = join(ROOT, "apps", "web", "node_modules", "@fontsource");
const OWNER_EMAIL = "owner@demo-agency.test";

const staging = mkdtempSync(join(tmpdir(), "bold-fidelity-"));
const captured = new Map(); // name -> { viewport }
let failed = false;
const fail = (msg) => {
  console.error(`CAPTURE FAILED: ${msg}`);
  failed = true;
};

/* ---- offline prototype serving (React UMD, fonts, mark.svg, avatars) ---- */
const faces = [];
for (const w of [400, 500, 600, 700, 800, 900])
  faces.push(["Schibsted Grotesk", w, join(FONTS, "schibsted-grotesk", "files", `schibsted-grotesk-latin-${w}-normal.woff2`)]);
for (const w of [400, 500, 600, 700])
  faces.push(["IBM Plex Sans", w, join(FONTS, "ibm-plex-sans", "files", `ibm-plex-sans-latin-${w}-normal.woff2`)]);
for (const w of [400, 500, 600])
  faces.push(["IBM Plex Mono", w, join(FONTS, "ibm-plex-mono", "files", `ibm-plex-mono-latin-${w}-normal.woff2`)]);
const fontCss = faces
  .map(([fam, w], i) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(https://local.fonts/f${i}.woff2) format('woff2');}`)
  .join("\n");
// The React 18 UMD pair the prototype's DC runtime loads from unpkg — vendored
// per run from the local pnpm store is not possible offline, so callers keep
// the pair in the scratch dir the B0 port established, or set REACT_UMD_DIR.
const UMD = process.env.REACT_UMD_DIR ?? "/tmp/claude-0/-home-user-clientforce-platform/44de266c-7e4c-55d4-96f0-d099e04fb9c2/scratchpad";

async function wire(ctx) {
  await ctx.route("**/react.production.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: readFileSync(join(UMD, "react.js"), "utf8") }));
  await ctx.route("**/react-dom.production.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: readFileSync(join(UMD, "react-dom.js"), "utf8") }));
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: fontCss }));
  await ctx.route("https://local.fonts/**", (r) => {
    const i = Number(new URL(r.request().url()).pathname.match(/f(\d+)\.woff2/)?.[1] ?? 0);
    r.fulfill({ contentType: "font/woff2", body: readFileSync(faces[i][2]) });
  });
  await ctx.route("**/assets/mark.svg", (r) => r.fulfill({ contentType: "image/svg+xml", body: readFileSync(join(ROOT, "packages", "theme", "assets", "mark.svg"), "utf8") }));
  await ctx.route("https://i.pravatar.cc/**", (r) =>
    r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#E2E4E3"/></svg>' }),
  );
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});

async function page(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await wire(ctx);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fail(`pageerror: ${String(e).slice(0, 200)}`));
  return p;
}

async function shot(p, name) {
  if (failed) return;
  await p.waitForTimeout(1100);
  const crashed = await p.getByText("Application error", { exact: false }).isVisible().catch(() => false);
  if (crashed) {
    fail(`error boundary visible at ${name}`);
    return;
  }
  const vp = p.viewportSize();
  await p.screenshot({ path: join(staging, `${name}.png`) });
  captured.set(name, { viewport: `${vp.width}x${vp.height}` });
  console.log("captured", name);
}

async function run(label, fn) {
  if (failed) return;
  try {
    await fn();
  } catch (e) {
    fail(`${label}: ${String(e).slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------ shared helpers */
const freshProto = async (p) => {
  await p.goto(PROTO);
  await p.waitForTimeout(2600);
  const later = p.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
};

const signInBuild = async (p) => {
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Email").fill(OWNER_EMAIL);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.getByTestId("agents-subtitle").waitFor();
  const active = await p.getByTestId("ws-active-name").textContent().catch(() => "");
  if (active?.trim() !== "Demo Workspace") {
    await p.getByTestId("ws-switcher").click();
    await p.getByTestId("ws-option-demo").click();
    await p.waitForTimeout(400);
  }
};

const toBoldCampaign = async (p) => {
  await p.goto(`${BASE}/bold`);
  await p.getByTestId("bold-root").waitFor();
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.waitForTimeout(700);
  const later = p.getByText("Later", { exact: true }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  await p.getByTestId("bold-camps-list").getByText("Implant open day").click();
  await p.waitForTimeout(900);
};



/* --------------------------------------------------------------- the b45 set */
if (UNIT === "b45") {
  // The transient DB fixture that stands in for a genuinely live Ada call
  // (no local voice loop exists) — always torn down at the end.
  const FIXTURE_DB = process.env.FIXTURE_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/clientforce";
  const fixture = (phase) =>
    execSync(`pnpm --filter @clientforce/db exec tsx prisma/b45-live-fixture.ts ${phase}`, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: FIXTURE_DB },
    })
      .toString()
      .trim();

  await run("prototype-b45", async () => {
    const p = await page({ width: 1440, height: 900 });
    await p.goto(PROTO_LEGACY);
    await p.waitForTimeout(2600);
    // The legacy demo starts unowned: own the receptionist through its own
    // upsell + 3-step wizard (Continue · Continue · Go live — step 3 carries
    // the owner's fifth "Act through integrations" toggle), which lands on
    // the panel home, then run the scripted preview — the ruled rcpCallOpen
    // lifecycle (~18s: ring to t=4, a line every 3s, done at 18).
    await p.locator(".dockTile").first().click();
    await p.waitForTimeout(600);
    await p.getByText("Add to plan", { exact: true }).first().click();
    await p.waitForTimeout(600);
    for (let i = 0; i < 4; i++) {
      const next = p.getByText(/^(Continue|Go live)$/).first();
      if (await next.isVisible().catch(() => false)) {
        await next.click();
        await p.waitForTimeout(700);
      }
    }
    await p.getByText("Preview a call", { exact: true }).first().click();
    await shot(p, "proto-call-ring-1440x900"); // shot's settle lands inside the 4s ring
    await p.waitForTimeout(13600); // ≈t=15: the live state with the script well along
    await shot(p, "proto-call-live-1440x900");
    await p.waitForTimeout(3800); // past t=18: handled
    await shot(p, "proto-call-handled-1440x900");
    await p.context().close();
  });

  await run("build-b45", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    try {
      // A real (fixture-driven) call walks the SAME card through its phases —
      // the card's own 2s poll flips it, no reloads.
      fixture("ring");
      await p.goto(`${BASE}/bold`);
      await p.getByTestId("bold-root").waitFor();
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const later = p.getByText("Later", { exact: true }).first();
      if (await later.isVisible().catch(() => false)) await later.click();
      await p.getByTestId("bold-livecall").waitFor({ timeout: 15_000 });
      await shot(p, "build-call-ring-1440x900");
      fixture("live");
      await p.getByText("✦ Ada on the line").waitFor({ timeout: 15_000 });
      await p.waitForTimeout(600);
      await shot(p, "build-call-live-1440x900");
      fixture("handled");
      await p.getByText("Call handled").waitFor({ timeout: 15_000 });
      await p.waitForTimeout(600);
      await shot(p, "build-call-handled-1440x900");
    } finally {
      fixture("done");
    }
    // The pitch's labeled preview — the honesty adaptations on the same card.
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const later2 = p.getByText("Later", { exact: true }).first();
    if (await later2.isVisible().catch(() => false)) await later2.click();
    // The panel is flag-gated and the shell fetches flags on mount — settle
    // first, and re-click if the first click raced the fetch.
    await p.waitForTimeout(1500);
    await p.getByTestId("bold-dock-rcp").click();
    if (!(await p.getByTestId("bold-rcp-preview").isVisible().catch(() => false))) {
      await p.waitForTimeout(1500);
      await p.getByTestId("bold-dock-rcp").click();
    }
    await p.getByTestId("bold-rcp-preview").waitFor();
    await p.getByTestId("bold-rcp-preview").click();
    await p.getByTestId("bold-livecall-answer").waitFor();
    await p.getByTestId("bold-livecall-answer").click();
    await p.getByText("Call handled").waitFor({ timeout: 25_000 });
    await p.waitForTimeout(600);
    await shot(p, "build-preview-handled-1440x900");
    await p.context().close();
  });
}

/* ---------------------------------------------------------------- the b4 set */
if (UNIT === "b4") {
  await run("prototype-b4", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // The Site agent surface (dock tile "Site agent").
    await p.locator('[title^="Site agent"]').first().click();
    await p.waitForTimeout(800);
    await shot(p, "proto-siteagent-1440x900");
    // The receptionist slide-over — the prototype opens it from the dock.
    await p.locator('[title^="Receptionist"]').first().click();
    await p.waitForTimeout(800);
    await shot(p, "proto-rcp-pitch-1440x900");
    await p.context().close();
  });

  await run("build-b4", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-dock-chatbot").click();
    await p.getByTestId("bold-siteagent-strip").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(700);
    await shot(p, "build-siteagent-1440x900");
    await p.getByTestId("bold-dock-rcp").click();
    await p.getByTestId("bold-rcp").waitFor();
    await p.waitForTimeout(700);
    await shot(p, "build-rcp-pitch-1440x900");
    await p.getByTestId("bold-rcp-close").click();
    await p.context().close();
  });
}

/* --------------------------------------------------------------- the b3d set */
if (UNIT === "b3d") {
  await run("prototype-b3d", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // The campaign Settings tab — HOW MUCH ADA DECIDES is its first block.
    await p.getByText("Settings", { exact: true }).first().click();
    await p.waitForTimeout(800);
    await shot(p, "proto-settings-auto-1440x900");
    await p.context().close();
  });

  await run("build-b3d", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await toBoldCampaign(p);
    // The live Settings radio (restored to the default at the end).
    await p.getByText("Settings", { exact: true }).click();
    await p.getByTestId("bold-settings").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    await shot(p, "build-settings-auto-1440x900");
    // Overview: the amber needs strip with live counts.
    await p.getByText("Overview", { exact: true }).click();
    await p.getByTestId("bold-needs-strip").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    await shot(p, "build-needs-strip-1440x900");
    // The approvals panel open.
    await p.getByTestId("bold-needs-strip").click();
    await p.getByTestId("bold-approvals").waitFor();
    await p.waitForTimeout(700);
    await shot(p, "build-approvals-panel-1440x900");
    await p.getByTestId("bold-approvals-close").click();
    await p.context().close();
  });
}

/* -------------------------------------------------------------- the b3c2 set */
if (UNIT === "b3c2") {
  // The seed's call-clock fixtures — pick whichever contact is awake so the
  // human dial clears the 08:00–21:00 contact-local floor at ANY capture hour.
  const CLOCK_CONTACTS = [
    ["Sofia Reyes", "America/Chicago"],
    ["Alan Turing", "Europe/Berlin"],
    ["Edsger Dijkstra", "Asia/Tokyo"],
  ];
  const localHour = (tz) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date())
        .find((p) => p.type === "hour").value,
    );
  const awake = (CLOCK_CONTACTS.find(([, tz]) => {
    const h = localHour(tz);
    return h >= 9 && h < 20;
  }) ?? CLOCK_CONTACTS[0])[0];

  await run("prototype-b3c2", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // The prototype's in-call anatomy lives in the receptionist demo's live
    // ring widget — open the slide-over, play the demo call, capture mid-ring.
    await p.getByText("Receptionist", { exact: true }).first().click();
    await p.waitForTimeout(800);
    const hear = p.getByText(/Hear a (live )?call/).first();
    await hear.click();
    await p.waitForTimeout(2600);
    await shot(p, "proto-ring-widget-1440x900");
    await p.context().close();
  });

  await run("build-b3c2", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-dock-contacts").click();
    await p.locator('[data-testid^="bold-ct-card-"]').filter({ hasText: awake }).click();
    await p.getByTestId("bold-person-name").waitFor();
    // Consent unknown (the truthful default) → Ada blocked, the human leg live.
    await p.getByTestId("bold-person-consent-unknown").click();
    await p.waitForTimeout(600);
    await p.getByTestId("bold-person-call").click();
    await p.getByTestId("bold-person-call-human").waitFor();
    await p.waitForTimeout(400);
    await shot(p, "build-callsheet-human-1440x900");
    // The practice-line card (keyless sandbox, labeled in plain words).
    await p.getByTestId("bold-person-call-human").click();
    await p.getByTestId("bold-callcard-sandbox").waitFor({ timeout: 12_000 });
    await p.waitForTimeout(1400);
    await shot(p, "build-callcard-practice-1440x900");
    // End + close — the sandbox row resolves, nothing dangles.
    await p.getByTestId("bold-callcard-end").click();
    await p.waitForTimeout(800);
    const endBtn = p.getByTestId("bold-callcard-end");
    if (await endBtn.isVisible().catch(() => false)) await endBtn.click();
    // The settings recording toggle (internal-only surface — no prototype).
    await p.goto(`${BASE}/settings`);
    await p.getByTestId("nav-phone").click();
    await p.getByTestId("call-recording-card").waitFor();
    await p.waitForTimeout(600);
    await shot(p, "build-recording-toggle-1440x900");
    await p.context().close();
  });
}

/* -------------------------------------------------------------- the b3c1 set */
if (UNIT === "b3c1") {
  await run("prototype-b3c1", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // The contact detail's Call action (instant-dial in the prototype).
    await p.locator('[title="Contacts"]').first().click();
    await p.waitForTimeout(600);
    await p.getByText("Sofia Reyes", { exact: true }).first().click();
    await p.waitForTimeout(600);
    await shot(p, "proto-contact-call-1440x900");
    await p.context().close();
  });

  await run("build-b3c1", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-dock-contacts").click();
    await p.locator('[data-testid^="bold-ct-card-"]').filter({ hasText: "Sofia Reyes" }).click();
    await p.getByTestId("bold-person-name").waitFor();
    // Consent-blocked sheet (unknown is the truthful default state).
    await p.getByTestId("bold-person-consent-unknown").click();
    await p.waitForTimeout(600);
    await p.getByTestId("bold-person-call").click();
    await p.getByTestId("bold-person-call-blocked").waitFor();
    await p.waitForTimeout(400);
    await shot(p, "build-call-blocked-1440x900");
    // Granted → the checkable best-time sheet. Restored afterwards.
    await p.getByTestId("bold-person-consent-granted").click();
    await p.getByTestId("bold-person-call-queue").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    await shot(p, "build-call-sheet-1440x900");
    await p.getByTestId("bold-person-consent-unknown").click();
    await p.waitForTimeout(600);
    // The plan editor's live Calls step row.
    await p.getByTestId("bold-camps-list").getByText("Implant open day").click();
    await p.getByText("Plan", { exact: true }).click();
    await p.getByTestId("bold-plan-add").waitFor({ timeout: 15_000 });
    await p.getByTestId("bold-plan-add").click();
    await p.getByTestId("bold-plan-add-voice").waitFor();
    await p.waitForTimeout(400);
    await shot(p, "build-addstep-calls-1440x900");
    await p.context().close();
  });
}

/* -------------------------------------------------------------- the b3b set */
if (UNIT === "b3b") {
  await run("prototype-b3b", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    await p.locator('[title="Inbox"]').first().click();
    await p.waitForTimeout(600);
    // Tom's thread carries the ✦ Ada drafted card (why line · Rewrite · Send).
    await p.getByText("Tom Becker", { exact: true }).first().click();
    await p.waitForTimeout(500);
    await shot(p, "proto-reply-draft-1440x900");
    await p.getByText("Send", { exact: true }).first().click();
    await p.waitForTimeout(500);
    await shot(p, "proto-reply-sent-1440x900");
    await p.context().close();
  });

  await run("build-b3b", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-dock-wsinbox").click();
    await p.locator('[data-testid^="bold-inbox-thread-"]').filter({ hasText: "Alan Turing" }).click();
    await p.getByTestId("bold-inbox-composer").waitFor();
    // A leftover hold from a previous run is resumed first (clean frame).
    const stale = p.getByTestId("bold-inbox-resume");
    if (await stale.isVisible().catch(() => false)) {
      await stale.click();
      await p.waitForTimeout(800);
    }
    await p.getByTestId("bold-inbox-replytext").fill("Most people are back to normal food in three days — happy to hold Thursday 9:00 while you decide.");
    await p.waitForTimeout(400);
    await shot(p, "build-reply-composer-1440x900");
    // A REAL send through the boundary (sandbox transport — nothing delivered,
    // the ledger row and the reply-hold are real). Resumed after the frame.
    await p.getByTestId("bold-inbox-send").click();
    await p.getByTestId("bold-inbox-held").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    await shot(p, "build-reply-sent-held-1440x900");
    await p.getByTestId("bold-inbox-resume").click();
    await p.waitForTimeout(600);
    await p.getByTestId("bold-inbox-assign").click();
    await p.waitForTimeout(400);
    await shot(p, "build-inbox-assign-1440x900");
    // The DEC-114 slot, live: Ada Lovelace's paid-no-review rule (deferred
    // action, visible provenance).
    await p.getByTestId("bold-dock-contacts").click();
    await p.locator('[data-testid^="bold-ct-card-"]').filter({ hasText: "Ada Lovelace" }).click();
    await p.getByTestId("bold-person-nextstep").waitFor({ timeout: 15_000 });
    await p.waitForTimeout(500);
    await shot(p, "build-nextstep-1440x900");
    await p.context().close();
  });
}

/* --------------------------------------------------------------- the b3 set */
if (UNIT === "b3") {
  await run("prototype-b3", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // Dock → workspace Inbox (title tooltips are the dock's identity).
    await p.locator('[title="Inbox"]').first().click();
    await p.waitForTimeout(600);
    await shot(p, "proto-wsinbox-1440x900");
    await p.locator('[title="Contacts"]').first().click();
    await p.waitForTimeout(600);
    await shot(p, "proto-contacts-grid-1440x900");
    await p.locator('[title="List"]').first().click();
    await p.waitForTimeout(400);
    await shot(p, "proto-contacts-list-1440x900");
    // The contact detail overlay (§7's avatar-header rule).
    await p.getByText("Maya Collins", { exact: true }).first().click();
    await p.waitForTimeout(600);
    await shot(p, "proto-contact-detail-1440x900");
    await p.context().close();
  });

  await run("build-b3", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-dock-wsinbox").click();
    await p.locator('[data-testid^="bold-inbox-thread-"]').first().waitFor();
    await p.waitForTimeout(700);
    await shot(p, "build-wsinbox-1440x900");
    await p.getByTestId("bold-dock-contacts").click();
    await p.locator('[data-testid^="bold-ct-card-"]').first().waitFor();
    await p.waitForTimeout(600);
    await shot(p, "build-contacts-grid-1440x900");
    await p.getByTestId("bold-ct-view-list").click();
    await p.locator('[data-testid^="bold-ct-row-"]').first().waitFor();
    await p.waitForTimeout(400);
    await shot(p, "build-contacts-list-1440x900");
    // The person detail on the seeded booked contact.
    await p.locator('[data-testid^="bold-ct-row-"]').filter({ hasText: "Ada Lovelace" }).click();
    await p.getByTestId("bold-person-name").waitFor();
    await p.waitForTimeout(600);
    await shot(p, "build-contact-detail-1440x900");
    await p.context().close();
  });
}

/* -------------------------------------------------------------- the b26 set */
if (UNIT === "b26") {
  await run("prototype-b26", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    // The rail ✦ ADA SUGGESTS block renders on the default overview.
    await shot(p, "proto-sugg-rail-1440x900");
    await p.getByText("All", { exact: true }).first().click();
    await p.waitForTimeout(500);
    await shot(p, "proto-sugg-camps-1440x900");
    await p.context().close();
  });

  await run("build-b26", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    // The shell's sweep proposes the real draft; wait for the ✦ block.
    await p.getByTestId("bold-suggests").waitFor({ timeout: 20_000 });
    await p.waitForTimeout(700);
    await shot(p, "build-sugg-rail-1440x900");
    await p.getByText("All", { exact: true }).click();
    await p.locator('[data-testid^="bold-sugg-row-"]').waitFor();
    await p.waitForTimeout(400);
    await shot(p, "build-sugg-camps-1440x900");
    await p.locator('[data-testid^="bold-sugg-row-"]').getByText("Start it", { exact: true }).click();
    await p.getByTestId("bold-create").waitFor();
    await p.waitForTimeout(500);
    await shot(p, "build-sugg-resume-1440x900");
    // Evidence runs leave no rows: the swept draft goes away through the
    // shipped surface (the next load's sweep recreates it).
    const agents = await (await p.request.get(`${BASE}/api/cf/agents`)).json();
    const sugg = agents.find((a) => a.name === "Win back the not-nows");
    if (sugg) await p.request.delete(`${BASE}/api/cf/agents/${sugg.id}`);
    await p.context().close();
  });
}

/* -------------------------------------------------------------- the b25 set */
if (UNIT === "b25") {
  await run("prototype-b25", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    await p.getByText("All", { exact: true }).first().click();
    await p.getByText("New campaign", { exact: true }).first().click();
    await p.waitForTimeout(500);
    await shot(p, "proto-create-goal-1440x900");
    const protoNext = async () => {
      const anyway = p.getByText("Continue anyway", { exact: true }).first();
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
      else await p.getByText("Continue", { exact: true }).first().click();
      await p.waitForTimeout(400);
    };
    await protoNext(); // → who
    await p.getByText("A file you upload").first().click();
    await p.waitForTimeout(300);
    await p.getByText("Choose a CSV", { exact: true }).first().click();
    await p.waitForTimeout(400);
    await shot(p, "proto-create-who-csv-1440x900");
    await protoNext(); // → know
    await shot(p, "proto-create-know-1440x900");
    await protoNext(); // → value
    await shot(p, "proto-create-value-1440x900");
    await protoNext(); // → chan
    await shot(p, "proto-create-chan-1440x900");
    await protoNext(); // → plan ("The plan looks right" is the label here)
    await shot(p, "proto-create-plan-1440x900");
    const planNext = p.getByText("The plan looks right", { exact: true }).first();
    if (await planNext.isVisible().catch(() => false)) await planNext.click();
    else await protoNext();
    await p.waitForTimeout(400); // → guard
    await shot(p, "proto-create-guard-1440x900");
    await protoNext(); // → review
    await shot(p, "proto-create-review-1440x900");
    await p.context().close();
  });

  await run("build-b25", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByText("All", { exact: true }).click();
    await p.getByTestId("bold-new-campaign").click();
    await p.getByTestId("bold-create").waitFor();
    // Focusing inputs scrolls the canvas — every b25 shot snaps back to top
    // first so the pane header and full rail are always in frame.
    const snap = async (name) => {
      await p.evaluate(() => {
        const el = document.querySelector('[data-testid="bold-canvas-scroll"]');
        if (el) el.scrollTop = 0;
      });
      await shot(p, name);
    };
    await p.getByTestId("bold-goal-book_appointments").click();
    await p.getByTestId("bold-create-spec").fill("Implant consults for the 21st");
    await p.waitForTimeout(300);
    await snap("build-create-goal-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-who-csv").click();
    // The mapping state only — Import is never clicked in a capture run
    // (evidence must not write demo rows).
    await p.getByTestId("bold-csv-input").setInputFiles({
      name: "lapsed-patients-2026.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Full Name,Email Address,Mobile,Opted In\nSofia Reyes,sofia.reyes@example.test,+15125550142,yes\nAlan Turing,alan@demo-agency.test,,yes\nQuiet Row,quiet@example.test,,no",
      ),
    });
    await p.waitForTimeout(400);
    await snap("build-create-who-csv-1440x900");
    await p.getByTestId("bold-who-list").click();
    await p.getByTestId("bold-list-picker").waitFor();
    await p.waitForTimeout(400);
    await snap("build-create-who-picker-1440x900");
    await p.locator('[data-testid^="bold-list-pick-"]').first().click();
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-know-stat").waitFor();
    await p.waitForTimeout(500);
    await snap("build-create-know-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-value-unit").fill("2400");
    await p.getByTestId("bold-value-target").fill("12");
    await p.waitForTimeout(300);
    await snap("build-create-value-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-chan-email").waitFor();
    await snap("build-create-chan-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-plan-starter").click();
    await p.getByTestId("bold-plan-node-create-step-1").waitFor();
    await p.waitForTimeout(400);
    await snap("build-create-plan-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-guard-suppress").waitFor();
    await snap("build-create-guard-1440x900");
    await p.getByTestId("bold-create-next").click();
    await p.getByTestId("bold-review").waitFor();
    await p.waitForTimeout(300);
    await snap("build-create-review-1440x900");
    // Cleanup: the capture run's draft agent (never launched) is deleted
    // through the shipped surface so evidence runs leave no rows behind.
    const agents = await (await p.request.get(`${BASE}/api/cf/agents`)).json();
    const draft = agents.find((a) => a.name === "Implant consults for the 21st");
    if (draft) await p.request.delete(`${BASE}/api/cf/agents/${draft.id}`);
    await p.context().close();
  });
}

/* --------------------------------------------------------------- the b2 set */
if (UNIT === "b2") {
  await run("prototype-b2", async () => {
    const p = await page({ width: 1440, height: 900 });
    await freshProto(p);
    await p.getByText("Pipeline", { exact: true }).first().click();
    await shot(p, "proto-pipeline-board-1440x900");
    await p.getByText("List", { exact: true }).first().click();
    await shot(p, "proto-pipeline-list-1440x900");
    await p.getByText("Plan", { exact: true }).first().click();
    await shot(p, "proto-plan-1440x900");
    await p.getByText("The opener", { exact: true }).first().click();
    await shot(p, "proto-plan-step-1440x900");
    await freshProto(p);
    await p.getByText("Inbox", { exact: true }).first().click();
    await shot(p, "proto-inbox-1440x900");
    await p.context().close();
  });

  await run("build-b2", async () => {
    const p = await page({ width: 1440, height: 900 });
    await signInBuild(p);
    await toBoldCampaign(p);
    await p.getByTestId("bold-tab-pipeline").click();
    await p.getByTestId("bold-pipe-board").waitFor();
    await shot(p, "build-pipeline-board-1440x900");
    await p.getByTestId("bold-pipe-view-list").click();
    await p.getByTestId("bold-pipe-list").waitFor();
    await shot(p, "build-pipeline-list-1440x900");
    await p.getByTestId("bold-tab-plan").click();
    await p.getByTestId("bold-plan-node-seed-step-1").waitFor();
    await p.waitForTimeout(600);
    await shot(p, "build-plan-1440x900");
    await p.getByTestId("bold-plan-node-seed-step-1").click();
    await p.getByTestId("bold-plan-sheet").waitFor();
    await shot(p, "build-plan-step-1440x900");
    await p.mouse.click(300, 300);
    await p.waitForTimeout(300);
    // Add-step popover — the DEC-061 capability disclosure on the sms row.
    await p.getByTestId("bold-plan-add").click();
    await p.waitForTimeout(300);
    await shot(p, "build-plan-add-1440x900");
    await p.getByTestId("bold-tab-inbox").click();
    await p.getByTestId("bold-inbox-pane").waitFor();
    await p.waitForTimeout(600);
    await shot(p, "build-inbox-1440x900");
    // TYPE picker open — live counts + the disabled honest-absence rows (Q-070).
    await p.getByTestId("bold-inbox-picker-type").click();
    await p.waitForTimeout(300);
    await shot(p, "build-inbox-type-1440x900");
    await p.context().close();
  });
}

/* ------------------------------------------------ prototype states (B1 set) */
if (UNIT === "b1") {
await run("prototype", async () => {
  const p = await page({ width: 1440, height: 900 });
  const fresh = async () => {
    await p.goto(PROTO);
    await p.waitForTimeout(2600);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
  };
  await fresh();
  await shot(p, "proto-overview-1440x900");
  await p.getByText("All activity →").first().click();
  await shot(p, "proto-activity-1440x900");
  await p.getByText(/Sent 22 openers/).first().click();
  await shot(p, "proto-grp-drawer-1440x900");
  await fresh();
  await p.getByText("Dr. Marcus Alvarez").first().click();
  await shot(p, "proto-person-drawer-1440x900");
  await fresh();
  await p.getByText("POTENTIAL", { exact: true }).first().click();
  await shot(p, "proto-num-drawer-1440x900");
  await fresh();
  await p.getByText("All", { exact: true }).first().click();
  await shot(p, "proto-camps-1440x900");
  await p.context().close();
});

/* ------------------------------------------------------------ build states */
await run("build", async () => {
  const p = await page({ width: 1440, height: 900 });
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Email").fill(OWNER_EMAIL);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.getByTestId("agents-subtitle").waitFor();
  const active = await p.getByTestId("ws-active-name").textContent().catch(() => "");
  if (active?.trim() !== "Demo Workspace") {
    await p.getByTestId("ws-switcher").click();
    await p.getByTestId("ws-option-demo").click();
    await p.waitForTimeout(400);
  }
  const toBold = async () => {
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await p.getByTestId("bold-camps-list").getByText("Implant open day").click();
    await p.waitForTimeout(900);
  };
  await toBold();
  await shot(p, "build-overview-1440x900");
  await p.getByTestId("bold-value-edit").click();
  await p.waitForTimeout(300);
  await shot(p, "build-value-edit-1440x900");
  await p.getByText("Cancel").click();
  await p.getByTestId("bold-stats-row").getByText("POTENTIAL", { exact: true }).click();
  await p.getByTestId("bold-drawer").waitFor();
  await shot(p, "build-num-drawer-1440x900");
  await p.mouse.click(700, 150);
  await p.waitForTimeout(300);
  await p.getByTestId("bold-all-activity").click();
  await p.getByTestId("bold-activity-page").waitFor();
  await shot(p, "build-activity-1440x900");
  await p.getByTestId("bold-act-filter-send").click();
  await p.waitForTimeout(600);
  await p.getByTestId("bold-activity-page").getByText(/Sent to 3/).click();
  await p.getByTestId("bold-drawer").waitFor();
  await p.waitForTimeout(600);
  await shot(p, "build-grp-drawer-1440x900");
  await p.mouse.click(700, 150);
  await p.waitForTimeout(300);
  await p.getByTestId("bold-act-filter-all").click();
  await p.waitForTimeout(600);
  await p.getByTestId("bold-activity-page").getByText(/Meeting booked/).first().click();
  await p.getByTestId("bold-drawer").waitFor();
  await p.waitForTimeout(800);
  await shot(p, "build-person-drawer-1440x900");
  await p.mouse.click(700, 150);
  await toBold();
  await p.getByTestId("bold-tab-pipeline").click();
  await shot(p, "build-tab-stub-1440x900");
  await p.getByText("All", { exact: true }).click();
  await p.getByTestId("bold-camps-page").waitFor();
  await shot(p, "build-camps-1440x900");
  await p.getByTestId("bold-camps-list").getByText("Review asks").click();
  await p.waitForTimeout(900);
  await shot(p, "build-overview-empty-1440x900");
  await p.context().close();
});

/* ------------------------------------------- acceptance-viewport regression */
for (const [w, h, tag] of [
  [1280, 720, "1280x720"],
  [924, 540, "924x540"],
]) {
  await run(`viewport ${tag}`, async () => {
    const p = await page({ width: w, height: h });
    await p.goto(`${BASE}/login`);
    await p.getByLabel("Email").fill(OWNER_EMAIL);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.getByTestId("agents-subtitle").waitFor();
    await p.goto(`${BASE}/bold`);
    await p.getByTestId("bold-root").waitFor();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(700);
    const later = p.getByText("Later", { exact: true }).first();
    if (await later.isVisible().catch(() => false)) await later.click();
    await shot(p, `build-overview-${tag}`);
    await p.context().close();
  });
}
}

await browser.close();

/* ------------------------------------------------- atomic promote + manifest */
if (failed) {
  console.error("Nothing promoted — docs/fidelity is untouched.");
  rmSync(staging, { recursive: true, force: true });
  process.exit(1);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim();
const commit = git("git rev-parse HEAD");
const dirty = git("git status --porcelain -- ':!docs/fidelity'").length > 0;

const frames = {};
for (const [name, meta] of [...captured.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const file = join(staging, `${name}.png`);
  frames[`${name}.png`] = {
    viewport: meta.viewport,
    bytes: statSync(file).size,
    sha256: sha256(file),
  };
}

// Promote: clear the unit dir, copy the complete fresh set, write the manifest.
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f), { force: true });
for (const name of Object.keys(frames)) copyFileSync(join(staging, name), join(OUT, name));
writeFileSync(
  join(OUT, "MANIFEST.json"),
  `${JSON.stringify(
    {
      unit: UNIT,
      commit,
      workingTreeDirtyAtCapture: dirty,
      capturedAt: new Date().toISOString(),
      baseUrl: BASE,
      note:
        "Single-run capture; every frame from one build. Verify a frame by hashing its bytes against this manifest — never by trusting an image cache. pnpm lint:fidelity enforces the binding.",
      frames,
    },
    null,
    2,
  )}\n`,
);
rmSync(staging, { recursive: true, force: true });
console.log(`promoted ${Object.keys(frames).length} frames + MANIFEST.json at ${commit.slice(0, 12)}${dirty ? " (dirty tree)" : ""}`);
