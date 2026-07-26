/**
 * Structural pins for the canon rules the widget must honor at the STYLESHEET
 * level — the ones a token test can't see. Source of truth:
 * `CONSOLE_V3_CANON.md` (repo root).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORNER_RADIUS_PX, resolveConfig } from "../src/config";

const widgetCss = readFileSync(join(__dirname, "..", "src", "styles", "widget.css"), "utf8");
const shellSrc = readFileSync(join(__dirname, "..", "src", "ui", "shell.ts"), "utf8");
const transportSrc = readFileSync(join(__dirname, "..", "src", "api", "transport.ts"), "utf8");
const canon = readFileSync(join(__dirname, "..", "..", "..", "CONSOLE_V3_CANON.md"), "utf8");

describe("§4 elevation — the widget's ONE shadow exception", () => {
  it("box-shadow appears exactly twice: launcher + panel", () => {
    const declarations = widgetCss.match(/^\s*box-shadow:/gm) ?? [];
    expect(declarations).toHaveLength(2);
    expect(canon).toContain("launcher + panel float over unknown host backgrounds");
  });

  it("both use the canon float token — no bespoke shadow values", () => {
    const values = [...widgetCss.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim());
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
    expect(widgetCss).toMatch(
      /\[data-agent-state="idle"\] \.cfw-launcher \.cfw-mark \{\s*animation: cfw-breathe/,
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

  it("the presence dot and unread badge are forest per §7", () => {
    const dot = widgetCss.slice(widgetCss.indexOf(".cfw-dot {"));
    expect(dot.slice(0, 200)).toContain("var(--cv3-forest)");
    const badge = widgetCss.slice(widgetCss.indexOf(".cfw-badge {"));
    expect(badge.slice(0, 420)).toContain("background: var(--cv3-forest)");
    // white numerals + 2px white ring
    expect(badge.slice(0, 420)).toContain("border: 2px solid var(--cv3-card)");
    expect(badge.slice(0, 420)).toContain("color: var(--cv3-card)");
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
    const block = widgetCss.slice(
      widgetCss.indexOf(".cfw-launcher {"),
      widgetCss.indexOf(".cfw-launcher-mark"),
    );
    expect(block).toContain("background: var(--cv3-card)");
    expect(block).toContain("border: 1px solid var(--cv3-line)");
    expect(block).not.toContain("var(--cfw-brand)");
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

  it("composer is white + hairline at radius 15; mic 32px white, send 32px forest", () => {
    const composer = block(".cfw-composer {", "}");
    expect(composer).toContain("background: var(--cv3-card)");
    expect(composer).toContain("border: 1px solid var(--cv3-line-input)");
    expect(composer).toContain("border-radius: 15px");
    const mic = block(".cfw-mic {", "}");
    expect(mic).toContain("width: 32px");
    expect(mic).toContain("background: var(--cv3-card)");
    const send = block(".cfw-send {", "}");
    expect(send).toContain("width: 32px");
    expect(send).toContain("background: var(--cv3-forest)");
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
