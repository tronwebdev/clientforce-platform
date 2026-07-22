import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_STATES, consoleV3Vars, subtleTextOnColor, textOnColor } from "../src/index";

const css = readFileSync(join(__dirname, "..", "src", "console-v3.css"), "utf8");

/** Parse `--cv3-*: value;` declarations out of the token source. Values may be
 * prettier-reflowed across lines — normalize all whitespace, including inside
 * parens, so formatting never fakes a parity drift. */
function parseCssVars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--cv3-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    out[m[1] as string] = (m[2] as string)
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();
  }
  return out;
}

describe("console-v3 token source ↔ typed mirror parity", () => {
  const cssVars = parseCssVars(css);

  it("every CSS custom property has a typed mirror entry with the same value", () => {
    for (const [name, value] of Object.entries(cssVars)) {
      expect(consoleV3Vars[name], `${name} missing from consoleV3Vars`).toBeDefined();
      expect(consoleV3Vars[name], `${name} value drift`).toBe(value);
    }
  });

  it("every typed mirror entry exists in the CSS source", () => {
    for (const name of Object.keys(consoleV3Vars)) {
      expect(cssVars[name], `${name} missing from console-v3.css`).toBeDefined();
    }
  });

  it("the sheet applies at document level AND inside shadow roots", () => {
    expect(css).toMatch(/:root\s*,\s*:host\s*\{/);
  });
});

describe("Console v3 Build Spec canon (owner ruling 2026-07-22)", () => {
  it("forest accent is the v3 canon — the retired pre-refresh green is gone", () => {
    expect(consoleV3Vars["--cv3-accent"]).toBe("#146b33");
    expect(consoleV3Vars["--cv3-accent-hover"]).toBe("#0f5227");
    const all = JSON.stringify(consoleV3Vars).toLowerCase();
    expect(all).not.toContain("#16a82a");
    expect(all).not.toContain("#0f7a28");
  });

  it("vivid #35E834 lives ONLY in the signature gradient + motion tokens — never a fill/text token", () => {
    const allowed = new Set([
      "--cv3-gradient-signature",
      "--cv3-vivid",
      "--cv3-vivid-fade",
      "--cv3-ping-ring",
    ]);
    for (const [name, value] of Object.entries(consoleV3Vars)) {
      if (allowed.has(name)) continue;
      expect(value.toLowerCase(), `${name} carries vivid green`).not.toContain("35e834");
      expect(value.replace(/\s/g, ""), `${name} carries vivid rgb`).not.toContain("53,232,52");
    }
  });

  it("zero box-shadows except the launcher + panel float (the documented widget exception)", () => {
    const shadowTokens = Object.keys(consoleV3Vars).filter((n) => n.startsWith("--cv3-shadow-"));
    expect(shadowTokens.sort()).toEqual(["--cv3-shadow-launcher", "--cv3-shadow-panel"]);
  });

  it("canon radii scale (9–12 / 14–16 / 22 / 999)", () => {
    expect(consoleV3Vars["--cv3-radius-sm"]).toBe("9px");
    expect(consoleV3Vars["--cv3-radius-md"]).toBe("12px");
    expect(consoleV3Vars["--cv3-radius-lg"]).toBe("16px");
    expect(consoleV3Vars["--cv3-radius-xl"]).toBe("22px");
    expect(consoleV3Vars["--cv3-radius-pill"]).toBe("999px");
  });

  it("canon type stacks (Schibsted display · IBM Plex UI/mono — Bricolage/Hanken retired)", () => {
    expect(consoleV3Vars["--cv3-font-display"]).toContain("Schibsted Grotesk");
    expect(consoleV3Vars["--cv3-font-ui"]).toContain("IBM Plex Sans");
    expect(consoleV3Vars["--cv3-font-mono"]).toContain("IBM Plex Mono");
    const all = JSON.stringify(consoleV3Vars);
    expect(all).not.toContain("Bricolage");
    expect(all).not.toContain("Hanken");
  });

  it("textOnColor: forest → white; light fills → canon ink", () => {
    expect(textOnColor("#146B33")).toBe("#FFFFFF");
    expect(textOnColor("#0F5227")).toBe("#FFFFFF");
    expect(textOnColor("#101613")).toBe("#FFFFFF");
    expect(textOnColor("#D0F56B")).toBe("#101613");
    expect(textOnColor("#FFFFFF")).toBe("#101613");
    expect(textOnColor("bogus")).toBe("#101613");
  });

  it("subtleTextOnColor follows the on-brand pair (dark side on canon ink)", () => {
    expect(subtleTextOnColor("#146B33")).toBe("rgba(255,255,255,.75)");
    expect(subtleTextOnColor("#D0F56B")).toBe("rgba(16,22,19,.6)");
  });
});

describe("agent-identity motion states", () => {
  it("exposes the four shipped states in order (fifth pends the states canon doc — Q-049)", () => {
    expect(AGENT_STATES).toEqual(["idle", "listening", "thinking", "replying"]);
  });
});
