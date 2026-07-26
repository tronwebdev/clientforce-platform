import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_MARK,
  AGENT_STATES,
  AGENT_STATE_MOTION,
  CONSOLE_STATES,
  DEFAULT_AGENT_NAME,
  WIDGET_STATE_TO_CONSOLE,
  consoleV3Vars,
  subtleTextOnColor,
  textOnColor,
} from "../src/index";

const css = readFileSync(join(__dirname, "..", "src", "console-v3.css"), "utf8");
/** The canon doc IS the source — these tests read it, not a copy of it. */
const canon = readFileSync(join(__dirname, "..", "..", "..", "CONSOLE_V3_CANON.md"), "utf8");

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

/** Markdown table rows of a canon section, split into trimmed cells. */
function canonRows(afterHeading: string, untilHeading: string): string[][] {
  const start = canon.indexOf(afterHeading);
  const end = canon.indexOf(untilHeading, start + 1);
  expect(start, `canon section ${afterHeading} missing`).toBeGreaterThan(-1);
  const block = canon.slice(start, end === -1 ? undefined : end);
  return block
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
}

function hexes(cell: string): string[] {
  return (cell.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toLowerCase());
}

describe("token source ↔ typed mirror parity", () => {
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

describe("CONSOLE_V3_CANON.md §1 — color tokens are the doc's, verbatim", () => {
  it("every named canon color token matches the doc's hex", () => {
    const rows = canonRows("## 1 · Color tokens", "**Retired");
    const seen: string[] = [];
    for (const cells of rows) {
      const label = (cells[0] ?? "").replace(/\*/g, "").trim();
      const values = hexes(cells[1] ?? "");
      if (values.length === 0) continue; // header row
      const base = `--cv3-${label}`;
      if (label === "warn") {
        expect(consoleV3Vars["--cv3-warn"]).toBe(values[0]);
        expect(consoleV3Vars["--cv3-warn-bg"]).toBe(values[1]);
        seen.push("warn");
        continue;
      }
      expect(consoleV3Vars[base], `${base} missing (canon §1 row "${label}")`).toBe(values[0]);
      seen.push(label);
    }
    // Guard the parser itself: §1 has 16 value rows (wash → bubble-agent;
    // `teal` is named by §2's ramp/operational states, not §1).
    expect(seen).toHaveLength(16);
    expect(seen).toContain("forest");
    expect(consoleV3Vars["--cv3-teal"]).toBe("#0e7d93"); // §2 engaged fg / Scheduled teal
    expect(consoleV3Vars["--cv3-bubble-agent"]).toBe("#f2f6f3"); // §1 (added 2026-07-26)
  });

  it("RETIRED values never appear in any token — the doc's must-never-return list", () => {
    const retiredLine = canon.slice(
      canon.indexOf("**Retired"),
      canon.indexOf("**Signature gradient"),
    );
    const retired = hexes(retiredLine);
    expect(retired).toEqual(
      expect.arrayContaining(["#16a82a", "#0f7a28", "#fbf7f0", "#f7f9f8", "#0c140f"]),
    );
    const all = JSON.stringify(consoleV3Vars).toLowerCase();
    for (const hex of retired) {
      expect(all, `retired ${hex} came back`).not.toContain(hex);
    }
  });

  it("the signature gradient is the doc's, and #35E834 appears ONLY there + in motion", () => {
    const docGradient = canon.slice(canon.indexOf("**Signature gradient:**"));
    expect(hexes(docGradient.slice(0, 120))).toEqual(["#36d7ed", "#35e834", "#d0f56b"]);
    const allowed = new Set(["--cv3-gradient-signature", "--cv3-vivid", "--cv3-vivid-ring"]);
    for (const [name, value] of Object.entries(consoleV3Vars)) {
      if (allowed.has(name)) continue;
      expect(value.toLowerCase(), `${name} carries vivid green`).not.toContain("35e834");
      expect(value.replace(/\s/g, ""), `${name} carries vivid rgb`).not.toContain("53,232,52");
    }
  });

  it("hero ink is the doc's gradient", () => {
    expect(consoleV3Vars["--cv3-gradient-hero-ink"]).toContain("#101613 25%");
    expect(consoleV3Vars["--cv3-gradient-hero-ink"]).toContain("#14743a 120%");
  });
});

describe("CONSOLE_V3_CANON.md §2 — semantic label system", () => {
  it("the pipeline temperature ramp matches the doc row for row", () => {
    const rows = canonRows("## 2 · Semantic label system", "Inbox reply categories");
    let checked = 0;
    for (const cells of rows) {
      const stage = (cells[0] ?? "").toLowerCase();
      const [fg, bg, line] = [
        hexes(cells[1] ?? "")[0],
        hexes(cells[2] ?? "")[0],
        hexes(cells[3] ?? "")[0],
      ];
      if (!fg || !bg || !line) continue;
      expect(consoleV3Vars[`--cv3-stage-${stage}-fg`], `stage ${stage} fg`).toBe(fg);
      expect(consoleV3Vars[`--cv3-stage-${stage}-bg`], `stage ${stage} bg`).toBe(bg);
      expect(consoleV3Vars[`--cv3-stage-${stage}-line`], `stage ${stage} border`).toBe(line);
      checked += 1;
    }
    expect(checked).toBe(7); // New → Lost
  });

  it("channel tints match the doc row for row", () => {
    const rows = canonRows("Channels carry a", "## 3 · Type");
    let checked = 0;
    for (const cells of rows) {
      const channel = (cells[0] ?? "").toLowerCase();
      const [fg, bg, line] = [
        hexes(cells[1] ?? "")[0],
        hexes(cells[2] ?? "")[0],
        hexes(cells[3] ?? "")[0],
      ];
      if (!fg || !bg || !line) continue;
      expect(consoleV3Vars[`--cv3-channel-${channel}-fg`], `${channel} fg`).toBe(fg);
      expect(consoleV3Vars[`--cv3-channel-${channel}-bg`], `${channel} bg`).toBe(bg);
      expect(consoleV3Vars[`--cv3-channel-${channel}-line`], `${channel} border`).toBe(line);
      checked += 1;
    }
    expect(checked).toBe(4);
  });
});

describe("CONSOLE_V3_CANON.md §3 — type (Direction D)", () => {
  it("ONE grotesk for display AND body/UI; IBM Plex Mono for data only", () => {
    expect(canon).toContain("Direction D");
    expect(consoleV3Vars["--cv3-font-display"]).toContain("Schibsted Grotesk");
    expect(consoleV3Vars["--cv3-font-ui"]).toContain("Schibsted Grotesk");
    expect(consoleV3Vars["--cv3-font-mono"]).toContain("IBM Plex Mono");
  });

  it("IBM Plex Sans is NOT the UI face (regression: the relayed-chat drift)", () => {
    expect(consoleV3Vars["--cv3-font-ui"]).not.toContain("IBM Plex Sans");
    expect(JSON.stringify(consoleV3Vars)).not.toContain("IBM Plex Sans");
  });

  it("retired legacy faces never return", () => {
    const all = JSON.stringify(consoleV3Vars);
    expect(all).not.toContain("Bricolage");
    expect(all).not.toContain("Hanken");
  });

  it("the type scale matches the doc", () => {
    expect(consoleV3Vars["--cv3-h1-size"]).toBe("32px");
    expect(consoleV3Vars["--cv3-h1-weight"]).toBe("900");
    expect(consoleV3Vars["--cv3-h2-size"]).toBe("22px");
    expect(consoleV3Vars["--cv3-h3-size"]).toBe("16px");
    expect(consoleV3Vars["--cv3-body-size"]).toBe("14.5px");
    expect(consoleV3Vars["--cv3-label-size"]).toBe("13px");
    expect(consoleV3Vars["--cv3-eyebrow-tracking"]).toBe("0.08em");
    expect(consoleV3Vars["--cv3-mono-size"]).toBe("12px");
  });
});

describe("CONSOLE_V3_CANON.md §4 — radius + elevation", () => {
  it("canon radii (9–12 small · 14–16 cards · 22 frames · 999 pills)", () => {
    expect(consoleV3Vars["--cv3-radius-sm"]).toBe("9px");
    expect(consoleV3Vars["--cv3-radius-md"]).toBe("12px");
    expect(consoleV3Vars["--cv3-radius-lg"]).toBe("16px");
    expect(consoleV3Vars["--cv3-radius-frame"]).toBe("22px");
    expect(consoleV3Vars["--cv3-radius-pill"]).toBe("999px");
  });

  it("exactly TWO shadow tokens exist, both the doc's float values", () => {
    const shadows = Object.keys(consoleV3Vars).filter((n) => n.startsWith("--cv3-shadow-"));
    expect(shadows.sort()).toEqual(["--cv3-shadow-card", "--cv3-shadow-float"]);
    expect(consoleV3Vars["--cv3-shadow-card"]).toBe(
      "0 1px 2px rgba(16, 22, 19, 0.04), 0 10px 30px rgba(16, 22, 19, 0.07)",
    );
    expect(consoleV3Vars["--cv3-shadow-float"]).toBe(
      "0 1px 2px rgba(16, 22, 19, 0.05), 0 18px 44px rgba(16, 22, 19, 0.16)",
    );
  });
});

describe("CONSOLE_V3_CANON.md §5/§6 — motion + agent identity", () => {
  it("every motion verb's timing matches the doc's table", () => {
    const rows = canonRows("## 5 · Motion", "## 6 · Agent identity");
    let checked = 0;
    for (const cells of rows) {
      const verb = cells[0] ?? "";
      const timing = (cells[1] ?? "").match(/^([\d.]+s)/)?.[1];
      if (!timing) continue;
      expect(consoleV3Vars[`--cv3-${verb}`], `motion ${verb}`).toBe(timing);
      checked += 1;
    }
    expect(checked).toBe(5); // breathe · ping · spin · slide · glow
  });

  it("the widget keeps FOUR chat verbs — canon forbids forcing a fifth", () => {
    expect(AGENT_STATES).toEqual(["idle", "listening", "thinking", "replying"]);
    expect(canon).toContain("do **not** force a fifth state into the widget");
  });

  it("the five console states + the recorded widget→console mapping (Q-049)", () => {
    expect(CONSOLE_STATES).toEqual(["ready", "thinking", "working", "needs-you", "held"]);
    expect(WIDGET_STATE_TO_CONSOLE).toEqual({
      idle: "ready",
      listening: "ready",
      thinking: "thinking",
      replying: "working",
    });
    // needs-you / held are console-only — deliberately unmapped from the widget.
    expect(Object.values(WIDGET_STATE_TO_CONSOLE)).not.toContain("needs-you");
    expect(Object.values(WIDGET_STATE_TO_CONSOLE)).not.toContain("held");
  });

  it("motion verb per widget state follows the doc's mark treatments", () => {
    expect(AGENT_STATE_MOTION).toEqual({
      idle: "breathe",
      listening: "ping",
      thinking: "spin",
      replying: "slide",
    });
  });

  it("the agent mark and default name are the doc's", () => {
    expect(AGENT_MARK).toBe("✦");
    expect(canon).toContain("The mark is the ✦ glyph on the signature gradient");
    expect(DEFAULT_AGENT_NAME).toBe("Ada");
    expect(canon).toContain("default name **Ada**");
  });
});

describe("contrast helpers", () => {
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
