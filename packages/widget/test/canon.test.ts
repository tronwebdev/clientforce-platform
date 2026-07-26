/**
 * Structural pins for the canon rules the widget must honor at the STYLESHEET
 * level — the ones a token test can't see. Source of truth:
 * `CONSOLE_V3_CANON.md` (repo root).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_STATES, consoleV3, textOnColor } from "@clientforce/theme";
import { CORNER_RADIUS_PX, resolveConfig, WIDGET_DEFAULTS } from "../src/config";

const widgetCss = readFileSync(join(__dirname, "..", "src", "styles", "widget.css"), "utf8");
const shellSrc = readFileSync(join(__dirname, "..", "src", "ui", "shell.ts"), "utf8");
const transportSrc = readFileSync(join(__dirname, "..", "src", "api", "transport.ts"), "utf8");
const canon = readFileSync(join(__dirname, "..", "..", "..", "CONSOLE_V3_CANON.md"), "utf8");

describe("§4 elevation — the widget's ONE shadow exception", () => {
  it("box-shadow is SET exactly twice: launcher + panel", () => {
    // `box-shadow: none` is a removal, not an elevation — the full-bleed
    // narrow-viewport panel has nothing to cast onto. Count only the setters.
    const setters = [...widgetCss.matchAll(/^\s*box-shadow:\s*([^;]+);/gm)]
      .map((m) => m[1]!.trim())
      .filter((v) => v !== "none");
    expect(setters).toHaveLength(2);
    expect(canon).toContain("launcher + panel float over unknown host backgrounds");
  });

  it("both use the canon float token — no bespoke shadow values", () => {
    const values = [...widgetCss.matchAll(/box-shadow:\s*([^;]+);/g)]
      .map((m) => m[1]!.trim())
      .filter((v) => v !== "none");
    expect(values).toEqual(["var(--cv3-shadow-float)", "var(--cv3-shadow-float)"]);
  });

  it("interiors are flat — no raw rgba/px shadow literals anywhere in the sheet", () => {
    expect(widgetCss).not.toMatch(/box-shadow:\s*\d/);
    expect(widgetCss).not.toMatch(/box-shadow:[^;]*rgba/);
  });
});

describe("§7 light-first — there is no dark canon", () => {
  it("the stylesheet carries no dark-theme rules or legacy dark literals", () => {
    expect(canon).toContain("light-first — there is no dark canon");
    expect(widgetCss).not.toContain('data-theme="dark"');
    expect(widgetCss).not.toContain("--cv3-dark");
    expect(widgetCss.toLowerCase()).not.toContain("#141b17");
  });

  it("config refuses a dark theme instead of rendering an un-canon'd skin", () => {
    const cfg = resolveConfig({ widgetId: "w", appearance: { theme: "dark" as never } });
    expect(cfg.appearance.theme).toBe("light");
  });
});

describe("§5 motion — canon verbs, canon timings, event-driven only", () => {
  it("every animation uses a canon timing token (no hard-coded verb durations)", () => {
    const verbs = ["cfw-breathe", "cfw-ping", "cfw-spin", "cfw-slide"];
    const tokens = ["--cv3-breathe", "--cv3-ping", "--cv3-spin", "--cv3-slide"];
    verbs.forEach((verb, i) => {
      const rule = new RegExp(`animation:\\s*${verb}\\s+var\\(${tokens[i]}\\)`);
      expect(widgetCss, `${verb} must ride ${tokens[i]}`).toMatch(rule);
    });
  });

  it("thinking is a CONIC ring (the canon's spin treatment)", () => {
    expect(canon).toContain("thinking (conic ring)");
    const thinking = widgetCss.slice(widgetCss.indexOf('data-agent-state="thinking"'));
    expect(thinking).toContain("conic-gradient");
  });

  it("the launcher never bobs for show — no perpetual decorative motion", () => {
    // Canon §5: "Event-driven only — the UI never fakes busy." The launcher
    // surface itself animates never; only the mark breathes, and only while
    // the agent state is idle/ready.
    expect(widgetCss).not.toContain("cfw-float");
    const launcherBlock = widgetCss.slice(
      widgetCss.indexOf(".cfw-launcher {"),
      widgetCss.indexOf("}", widgetCss.indexOf(".cfw-launcher {")),
    );
    expect(launcherBlock).not.toContain("animation:");
    // The mark breathes (either art), and only while the agent state is idle.
    expect(widgetCss).toMatch(
      /\[data-agent-state="idle"\] \.cfw-launcher \.cfw-mark,[\s\S]{0,120}animation: cfw-breathe var\(--cv3-breathe\)/,
    );
  });

  it("all animation is disabled under prefers-reduced-motion", () => {
    expect(widgetCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("§1/§7 color — canon tokens only", () => {
  it("the sheet holds zero raw color literals (tokens do all the work)", () => {
    expect(widgetCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("BRAND green derives from the accent: presence dot, unread badge, chip fill", () => {
    // Canon §7 (owner ruling 2026-07-26): split the greens by MEANING. Green
    // that is decorative or simply IS Clientforce derives from the workspace
    // accent, which DEFAULTS to canon forest — so §7's "forest dot / forest
    // badge" holds for every default workspace, and a #1F3A93 workspace gets no
    // stray green.
    expect(canon).toContain("Brand green vs semantic green");
    expect(WIDGET_DEFAULTS.appearance.brandColor).toBe(consoleV3.forest);
    const dot = widgetCss.slice(widgetCss.indexOf(".cfw-dot {"));
    expect(dot.slice(0, 200)).toContain("background: var(--cfw-brand)");
    const badge = widgetCss.slice(widgetCss.indexOf(".cfw-badge {"));
    expect(badge.slice(0, 420)).toContain("background: var(--cfw-brand)");
    // white numerals + 2px white ring
    expect(badge.slice(0, 420)).toContain("border: 2px solid var(--cv3-card)");
    expect(badge.slice(0, 420)).toContain("color: var(--cfw-on-brand)");
    expect(textOnColor(consoleV3.forest).toLowerCase()).toBe("#ffffff");
    // The chip fill is brand green too — no bare canon mint left in the sheet.
    expect(widgetCss).not.toContain("var(--cv3-mint)");
    expect(widgetCss).not.toContain("var(--cv3-mint-line)");
  });

  it("SEMANTIC green stays canon — the mint pair is exact on the canon accent", () => {
    // The tint vars carry canon mint verbatim for the canon accent, so the
    // default panel is byte-identical to the panel canon; any other accent
    // falls through to the sheet's color-mix tint.
    expect(shellSrc).toContain('setProperty("--cfw-brand-tint", consoleV3.mint)');
    expect(shellSrc).toContain('setProperty("--cfw-brand-tint-line", consoleV3.mintLine)');
    expect(widgetCss).toContain("var(--cfw-brand-tint, color-mix(");
    // Outcome cards (booked/sent/confirmed) are the semantic-green surface and
    // are honest-absent this unit — they ship with the flows, on canon mint.
    expect(canon).toContain("outcome confirmation");
    expect(widgetCss).not.toContain("cfw-outcome");
  });
});

describe("mock build note — NO EMOJI: line icons + the ✦ mark", () => {
  it("the shell renders no emoji iconography", () => {
    // Emoji_Presentation catches the retired 📅 📞 📄 🎙 set; ✦ (U+2726) is a
    // text-presentation glyph and is the canon mark, so it stays.
    expect(shellSrc).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(shellSrc).toContain("AGENT_MARK");
  });

  it("server-offered quick-action labels are emoji-free (the client draws the icon)", () => {
    expect(transportSrc).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(transportSrc).toContain('label: "Book a visit"');
  });

  it("every interactive glyph is a stroke line icon on currentColor", () => {
    const icons = readFileSync(join(__dirname, "..", "src", "ui", "icons.ts"), "utf8");
    expect(icons).toContain('stroke", "currentColor"');
    expect(icons).toContain('fill", "none"');
    expect(icons).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("mock KEY SURFACES — launcher", () => {
  it("the mark sits on WHITE with a hairline, not on the brand fill", () => {
    const start = widgetCss.indexOf(".cfw-launcher {");
    const block = widgetCss.slice(start, widgetCss.indexOf("}", start));
    expect(block).toContain("background: var(--cv3-card)");
    expect(block).toContain("border: 1px solid var(--cv3-line)");
    expect(block).not.toContain("var(--cfw-brand)");
  });

  it("the header tile is the ✦ AGENT mark; the brand mark is the launcher's", () => {
    // Panel mock + canon §6. The brand mark is platform-owned art and belongs
    // to the launcher surface only.
    expect(shellSrc).toMatch(
      /this\.orb\.appendChild\(el\(doc, "span", "cfw-agent-mark", AGENT_MARK\)\)/,
    );
    expect(shellSrc).toMatch(/this\.launcher\.appendChild\(markEl\(doc, 30\)\)/);
  });

  it("entry chips are TEXT-ONLY pills, first active flow primary (panel mock)", () => {
    expect(shellSrc).not.toContain("QUICK_ACTION_ICON");
    expect(shellSrc).toContain('chip.setAttribute("data-primary"');
    const primary = widgetCss.slice(widgetCss.indexOf(".cfw-chip[data-primary] {"));
    // Label AND fill ride the accent (§7 brand green); on the canon accent the
    // fill resolves to canon mint exactly — see the semantic-green test.
    expect(primary.slice(0, 260)).toContain("color: var(--cfw-brand)");
    expect(primary.slice(0, 260)).toContain("background: var(--cfw-brand-tint,");
  });

  it("the mark is the inlined brand asset — packages/theme/assets/mark.svg", () => {
    // Shipped from the shared theme layer (console + widget consume the same
    // file) and inlined, so the embed still fetches nothing at runtime.
    expect(shellSrc).toContain('from "@clientforce/theme/assets/mark.svg?raw"');
    const asset = readFileSync(join(__dirname, "..", "..", "theme", "assets", "mark.svg"), "utf8");
    expect(asset).toContain("<svg");
    expect(asset).toContain("linearGradient");
    const mark = widgetCss.slice(widgetCss.indexOf(".cfw-mark {"));
    expect(mark.slice(0, 300)).toContain("line-height: 0");
  });
});

describe("owner panel spec (2026-07-26) — the accent never paints a surface", () => {
  function block(selector: string, until: string): string {
    const start = widgetCss.indexOf(selector);
    expect(start, `${selector} missing`).toBeGreaterThan(-1);
    return widgetCss.slice(start, widgetCss.indexOf(until, start + 1));
  }

  it("header sits on the panel surface with a hairline bottom, never on the brand", () => {
    const header = block(".cfw-header {", "}");
    expect(header).toContain("background: var(--cv3-panel)");
    expect(header).toContain("border-bottom: 1px solid var(--cv3-line)");
    expect(header).not.toContain("var(--cfw-brand)");
  });

  it("header text is ink / muted / faint — not white-on-accent", () => {
    expect(block(".cfw-name {", "}")).toContain("color: var(--cv3-ink)");
    expect(block(".cfw-sub {", "}")).toContain("color: var(--cv3-muted)");
    expect(block(".cfw-close {", "}")).toContain("color: var(--cv3-faint)");
  });

  it("the mark is a 38px tile at radius 11 on the signature gradient", () => {
    const orb = block(".cfw-orb {", "}");
    expect(orb).toContain("width: 38px");
    expect(orb).toContain("border-radius: 11px");
    expect(orb).toContain("background: var(--cv3-gradient-signature)");
  });

  it("composer is a white hairline PILL; mic 34px white, send 32px forest", () => {
    // Geometry measured off docs/fidelity/wid/widget-panel-canon.png: the
    // composer's ends are true semicircles (48px tall ⇒ radius 24), so it is a
    // pill, not the radius-15 rect the written spec called for. 34px mic + 6px
    // padding + hairline = the measured 48px height.
    const composer = block(".cfw-composer {", "}");
    expect(composer).toContain("background: var(--cv3-card)");
    expect(composer).toContain("border: 1px solid var(--cv3-line-input)");
    expect(composer).toContain("border-radius: var(--cv3-radius-pill)");
    expect(composer).not.toContain("border-radius: 15px");
    const mic = block(".cfw-mic {", "}");
    expect(mic).toContain("width: 34px");
    expect(mic).toContain("background: var(--cv3-card)");
    const send = block(".cfw-send {", "}");
    expect(send).toContain("width: 32px");
    // "a 32px forest circle" — via the accent, whose default IS canon forest,
    // so a custom accent paints its own send button (README: brand fill for
    // launcher/send) instead of stranding platform green on the panel.
    expect(send).toContain("background: var(--cfw-brand)");
    expect(WIDGET_DEFAULTS.appearance.brandColor).toBe(consoleV3.forest);
  });

  it("chips are 32px pills: mint+forest primary, white/soft-hairline/muted rest", () => {
    const chip = block(".cfw-chip {", "}");
    expect(chip).toContain("height: 32px");
    expect(chip).toContain("padding: 0 14px");
    expect(chip).toContain("border: 1px solid var(--cv3-line-soft)");
    expect(chip).toContain("color: var(--cv3-muted)");
    expect(chip).toContain("border-radius: var(--cv3-radius-pill)");
  });

  it("message orbs are 26px and the chip row aligns to the bubble's left edge", () => {
    // Anchored to the line start — the white-label group also ends in
    // `.cfw-msg-orb {` and appears earlier in the sheet.
    const orb = block("\n.cfw-msg-orb {", "}");
    expect(orb).toContain("width: 26px");
    expect(orb).toContain("border-radius: 8px");
    // 26px orb + the row's 9px gap ⇒ chips start where the bubble starts.
    expect(block(".cfw-chips {", "}")).toContain("padding-left: 35px");
    expect(block(".cfw-row {", "}")).toContain("gap: 9px");
  });

  it("no parked focus ring — the composer ring is keyboard-focus only", () => {
    expect(widgetCss).not.toContain(".cfw-composer:focus-within");
    expect(widgetCss).toContain(".cfw-composer:has(.cfw-input:focus-visible)");
  });

  it("bubbles carry the owner values and notch toward the mark", () => {
    const agent = block(".cfw-bubble {", "}");
    expect(agent).toContain("background: var(--cv3-bubble-agent)");
    expect(agent).toContain("border-radius: 5px 14px 14px 14px");
    const visitor = block('.cfw-row[data-role="visitor"] .cfw-bubble {', "}");
    expect(visitor).toContain("background: var(--cv3-ink)");
    expect(visitor).toContain("color: var(--cv3-panel)");
    expect(visitor).toContain("border-radius: 14px 14px 4px 14px");
  });

  // Width + radius are confirmed by the mock (376 content box inside a 1px
  // `line` border, 20px corners). Height stays the owner's written 640: the
  // mock frame renders 592, which is a viewport-bound export height, not a spec
  // change — flagged in the §8 report rather than silently adopted.
  it("panel geometry is 376×640 at radius 20 (the default corner)", () => {
    const panel = block(".cfw-panel {", "}");
    expect(panel).toContain("width: 376px");
    expect(panel).toContain("height: 640px");
    expect(CORNER_RADIUS_PX.l).toBe(20);
  });

  it("every panel carries the platform line: 10.5px faint + an 11px gradient square", () => {
    const line = block(".cfw-poweredby {", "}");
    expect(line).toContain("font-size: 10.5px");
    expect(line).toContain("color: var(--cv3-faint)");
    const mark = block(".cfw-poweredby-mark {", "}");
    expect(mark).toContain("width: 11px");
    expect(mark).toContain("background: var(--cv3-gradient-signature)");
    expect(shellSrc).toContain("Powered by Clientforce Ai");
  });
});

describe("contract promotion (WID2/DEC-101) — one contract, zero bundle cost", () => {
  const contractSrc = readFileSync(join(__dirname, "..", "src", "api", "contract.ts"), "utf8");
  const coreWidgetSrc = readFileSync(
    join(__dirname, "..", "..", "core", "src", "widget.ts"),
    "utf8",
  );
  const srcDir = join(__dirname, "..", "src");

  it("core is imported TYPE-ONLY — the embed must not ship zod to a visitor", () => {
    // The server validates; a client-side validator would be bypassable anyway.
    // `import type` is erased at build time, so the types are shared and the
    // bundle stays dependency-free.
    expect(contractSrc).toContain("import type {");
    expect(contractSrc).toContain('} from "@clientforce/core"');
    const valueImports = [
      ...contractSrc.matchAll(/^import\s+(?!type\b)[^;]*from\s+"@clientforce\/core"/gm),
    ];
    expect(valueImports).toHaveLength(0);
  });

  it("no OTHER widget source touches core — contract.ts is the single seam", () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".ts") && !f.replace(/\\/g, "/").endsWith("api/contract.ts"),
    );
    const offenders = files.filter((f) =>
      readFileSync(join(srcDir, f), "utf8").includes('from "@clientforce/core"'),
    );
    expect(offenders).toEqual([]);
  });

  it("the duplicated contract constants agree with core's", () => {
    // contract.ts re-declares these two VALUES so importing them cannot pull
    // core into the bundle; this pin is what keeps the copies honest.
    expect(coreWidgetSrc).toContain("export const WIDGET_CONTRACT_VERSION = 1 as const;");
    expect(contractSrc).toContain("export const WIDGET_CONTRACT_VERSION = 1 as const;");
    const path = /WIDGET_SESSION_PATH = "(\/widget\/v1\/session)"/;
    expect(coreWidgetSrc.match(path)?.[1]).toBe(contractSrc.match(path)?.[1]);
  });

  it("the four agent states are the same union on both sides", () => {
    // core must not depend on a UI package, so theme owns the motion states and
    // core owns the wire union — pinned equal here instead of shared.
    expect(coreWidgetSrc).toContain(
      'export const WIDGET_AGENT_STATES = ["idle", "listening", "thinking", "replying"] as const;',
    );
    expect([...AGENT_STATES]).toEqual(["idle", "listening", "thinking", "replying"]);
  });

  it("the five chip kinds and six flows are core's, in panel order", () => {
    expect(coreWidgetSrc).toContain('"book_visit",');
    expect(coreWidgetSrc).toContain('"ask_question",');
    const flows = coreWidgetSrc.slice(coreWidgetSrc.indexOf("export const WIDGET_FLOWS"));
    ["bookVisit", "callMeBack", "scheduleCallback", "estimate", "liveVoice", "askQuestion"].forEach(
      (f) => expect(flows.slice(0, 300)).toContain(f),
    );
  });
});

describe("narrow viewports — canon §7 (no image anchor; the mock is desktop-only)", () => {
  const narrow = widgetCss.slice(widgetCss.indexOf("@media (max-width: 480px)"));

  it("the rule lives in the canon doc, not just in this sheet", () => {
    // Folded into §7 as a widget carryover on the owner's ruling, so a future
    // unit reads the geometry from canon rather than from an evidence note.
    expect(canon).toContain("Narrow viewports");
    expect(canon).toContain("full-bleed");
    expect(canon).toMatch(/Below a \*\*480px\*\* viewport/);
    expect(canon).toMatch(/376×640\*\* panel at radius 20\s*\n?\s*with its 24px inset/);
  });

  it("below 480px the panel is FULL-BLEED: inset 0, radius 0, no float", () => {
    expect(narrow).toContain("inset: 0");
    expect(narrow).toContain("border-radius: 0");
    expect(narrow).toContain("box-shadow: none");
    expect(narrow).toContain("max-height: none");
    // and it no longer centres a floating 376px panel (the retired deviation)
    expect(narrow).not.toContain("translateX(-50%)");
    expect(narrow).not.toContain("min(376px");
  });

  it("the launcher hides while the panel owns the viewport — ✕ is the only exit", () => {
    expect(narrow).toMatch(/\[data-state="open"\] \.cfw-cluster \{\s*display: none/);
  });

  it("the composer foot clears the home bar", () => {
    expect(narrow).toContain("env(safe-area-inset-bottom)");
  });

  it("above 480px the floating panel is untouched", () => {
    const desktop = widgetCss.slice(0, widgetCss.indexOf("@media (max-width: 480px)"));
    const panel = desktop.slice(desktop.indexOf(".cfw-panel {"));
    expect(panel.slice(0, 400)).toContain("width: 376px");
    expect(panel.slice(0, 400)).toContain("height: 640px");
    expect(panel.slice(0, 400)).toContain("box-shadow: var(--cv3-shadow-float)");
  });
});

describe("white-label — no platform-owned asset survives suppression", () => {
  it("the ✦ agent mark replaces the brand mark on the launcher", () => {
    expect(widgetCss).toContain(".cfw-root[data-white-label] .cfw-launcher .cfw-mark");
    const hidden = widgetCss.slice(
      widgetCss.indexOf(".cfw-root[data-white-label] .cfw-launcher .cfw-mark"),
    );
    expect(hidden.slice(0, 120)).toContain("display: none");
  });

  it("the workspace accent replaces the signature gradient on every identity surface", () => {
    const block = widgetCss.slice(
      widgetCss.indexOf(".cfw-root[data-white-label] .cfw-orb,"),
      widgetCss.indexOf("/* ---------- Thread"),
    );
    expect(block).toContain(".cfw-msg-orb");
    expect(block).toContain("background: var(--cfw-brand)");
    expect(block).toContain(".cfw-sweep::after");
    expect(block).not.toContain("gradient-signature");
  });

  it("the ✦ itself stays — it is the agent identity, not platform branding", () => {
    expect(shellSrc).toContain("AGENT_MARK");
    expect(canon).toMatch(/The ✦ itself\s+STAYS/);
  });
});
