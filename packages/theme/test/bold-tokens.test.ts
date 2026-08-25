import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOLD_DOCK_ORDER, consoleBold, consoleBoldVars } from "../src/index";

const css = readFileSync(join(__dirname, "..", "src", "console-bold.css"), "utf8");
/** The Bold tokens doc IS the source — read it, not a copy of it. */
const doc = readFileSync(
  join(__dirname, "..", "..", "..", "design_handoff_console_v3", "DESIGN_TOKENS_V3.md"),
  "utf8",
);
const bold = doc.slice(doc.indexOf("# §Bold"));

/** Parse `--cvb-*: value;` declarations, whitespace-normalized (see tokens.test). */
function parseCssVars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--cvb-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    out[m[1] as string] = (m[2] as string)
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();
  }
  return out;
}

describe("console-bold.css ↔ consoleBoldVars parity", () => {
  const cssVars = parseCssVars(css);

  it("every CSS var has a TS mirror with the same value", () => {
    for (const [k, v] of Object.entries(cssVars)) {
      expect(consoleBoldVars[k], `TS mirror missing/stale for ${k}`).toBe(v);
    }
  });

  it("every TS var exists in the CSS with the same value", () => {
    for (const [k, v] of Object.entries(consoleBoldVars)) {
      expect(cssVars[k], `CSS missing/stale for ${k}`).toBe(v);
    }
  });

  it("the sheet scopes to :root and :host (document + shadow-root use)", () => {
    expect(css).toMatch(/:root\s*,\s*:host/);
  });
});

describe("§Bold hard rules (DESIGN_TOKENS_V3.md is read directly)", () => {
  it("shell metrics match §Bold — fixed, not suggestions", () => {
    expect(bold).toContain("padding:26px");
    expect(bold).toContain("gap:18px");
    expect(bold).toContain("rail 228px");
    expect(bold).toContain("dock 52px");
    expect(bold).toContain("dock tile 38px / radius 13 / gap 4");
    expect(consoleBoldVars["--cvb-shell-pad"]).toBe("26px");
    expect(consoleBoldVars["--cvb-shell-gap"]).toBe("18px");
    expect(consoleBoldVars["--cvb-rail-w"]).toBe("228px");
    expect(consoleBoldVars["--cvb-dock-w"]).toBe("52px");
    expect(consoleBoldVars["--cvb-dock-tile"]).toBe("38px");
    expect(consoleBoldVars["--cvb-r-tile"]).toBe("13px");
    expect(consoleBoldVars["--cvb-dock-gap"]).toBe("4px");
  });

  it("the three permitted §Bold shadows are verbatim; the live glow matches", () => {
    const strip = (s: string) => s.replace(/\s+/g, "");
    for (const [token, docLine] of [
      ["--cvb-shadow-card", "0 1px 2px rgba(16,22,19,.05), 0 14px 38px -14px rgba(16,22,19,.18)"],
      ["--cvb-shadow-subtle", "0 1px 2px rgba(16,22,19,.035)"],
      ["--cvb-shadow-lift", "0 1px 2px rgba(16,22,19,.12), 0 8px 20px -8px rgba(20,107,51,.55)"],
      ["--cvb-glow-live", "0 0 0 7px rgba(20,107,51,.045)"],
    ] as const) {
      expect(strip(bold)).toContain(strip(docLine));
      // Token values normalize `.05` → `0.05`; compare with that normalization.
      expect(strip(consoleBoldVars[token] as string)).toBe(
        strip(docLine).replace(/rgba\((\d+),(\d+),(\d+),\./g, "rgba($1,$2,$3,0."),
      );
    }
  });

  it("recessed wells match §Bold (fill/border/inset)", () => {
    expect(bold).toContain("#F4F6F5");
    expect(bold).toContain("#E2E6E4");
    expect(consoleBoldVars["--cvb-well-fill"]).toBe("#f4f6f5");
    expect(consoleBoldVars["--cvb-well-line"]).toBe("#e2e6e4");
    expect(consoleBoldVars["--cvb-shadow-well"]).toContain("inset 0 1px 2px");
  });

  it("body is IBM Plex Sans, display Schibsted, mono IBM Plex Mono (§Bold type)", () => {
    expect(consoleBoldVars["--cvb-font-ui"]).toContain("IBM Plex Sans");
    expect(consoleBoldVars["--cvb-font-display"]).toContain("Schibsted Grotesk");
    expect(consoleBoldVars["--cvb-font-mono"]).toContain("IBM Plex Mono");
  });

  it("indicators: live #35E834, warn #E0A83A (§Indicators)", () => {
    expect(consoleBoldVars["--cvb-live"]).toBe("#35e834");
    expect(consoleBoldVars["--cvb-warn-dot"]).toBe("#e0a83a");
    expect(consoleBold.live).toBe("#35e834");
  });

  it("retired legacy values never appear (#16a82a, #0f7a28, warm creams, dark sidebar)", () => {
    const all = Object.values(consoleBoldVars).join(" ").toLowerCase();
    for (const banned of ["#16a82a", "#0f7a28", "#fbf7f0", "#f7f9f8", "#0c140f"]) {
      expect(all, `${banned} is retired and must not return`).not.toContain(banned);
    }
  });

  it("focus choreography ease is the LOCKED SHARP curve (Addendum 2 §F)", () => {
    expect(consoleBoldVars["--cvb-ease"]).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  });

  it("dock order is the Addendum 4 §3 fixed 11, Receptionist first", () => {
    expect(BOLD_DOCK_ORDER).toHaveLength(11);
    expect(BOLD_DOCK_ORDER[0]).toBe("receptionist");
    expect(BOLD_DOCK_ORDER[BOLD_DOCK_ORDER.length - 1]).toBe("settings");
  });

  it("no --cv3-* declarations leak into the Bold sheet (additive, no overwrites)", () => {
    expect(css).not.toMatch(/--cv3-[a-z0-9-]+\s*:/);
  });
});
