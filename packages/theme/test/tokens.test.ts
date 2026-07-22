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

describe("contrast discipline (DESIGN_TOKENS §1 AA rule)", () => {
  it("no text token carries the vivid green — vivid is fills/motion only", () => {
    const vivid = "#35e834";
    for (const name of Object.keys(consoleV3Vars)) {
      if (/(ink|text|muted)/.test(name)) {
        expect(consoleV3Vars[name]!.toLowerCase()).not.toContain(vivid);
      }
    }
    expect(consoleV3Vars["--cv3-accent"]).toBe("#16a82a");
    expect(consoleV3Vars["--cv3-accent-deep"]).toBe("#0f7a28");
  });

  it("textOnColor ports the prototype ink(): forest → white, lime → near-black", () => {
    expect(textOnColor("#16A82A")).toBe("#FFFFFF");
    expect(textOnColor("#0E1512")).toBe("#FFFFFF");
    expect(textOnColor("#D0F56B")).toBe("#0a0f0c");
    expect(textOnColor("#FFFFFF")).toBe("#0a0f0c");
    expect(textOnColor("bogus")).toBe("#0a0f0c");
  });

  it("subtleTextOnColor follows the prototype onBrandSub pair", () => {
    expect(subtleTextOnColor("#16A82A")).toBe("rgba(255,255,255,.75)");
    expect(subtleTextOnColor("#D0F56B")).toBe("rgba(10,15,12,.6)");
  });
});

describe("agent-identity motion states", () => {
  it("exposes the four console-v3 states in order", () => {
    expect(AGENT_STATES).toEqual(["idle", "listening", "thinking", "replying"]);
  });
});
