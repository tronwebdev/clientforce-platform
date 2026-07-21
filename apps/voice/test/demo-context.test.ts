/**
 * P3.1 deploy (DEC-090) — the demo disclosure variant rides the TwiML stream
 * parameter (a deployed container can't flip env between dials). The env
 * path (DEMO_SPOKEN_NAME) stays intact for the runner rig + certification.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoCallContext } from "../src/demo-context";

afterEach(() => vi.unstubAllEnvs());

describe("demoCallContext variant rider", () => {
  it("variant=named resolves a confirmed spoken name → named disclosure", () => {
    const ctx = demoCallContext("named");
    expect(ctx.disclosureVariant).toBe("named");
    expect(ctx.disclosure).toContain("this is Ava");
  });

  it("variant=default forces the default literal even with DEMO_SPOKEN_NAME set", () => {
    vi.stubEnv("DEMO_SPOKEN_NAME", "Ava");
    const ctx = demoCallContext("default");
    expect(ctx.disclosureVariant).toBe("default");
    expect(ctx.disclosure).not.toContain("Ava");
  });

  it("no variant falls back to the env path (runner rig unchanged)", () => {
    vi.stubEnv("DEMO_SPOKEN_NAME", "Maya");
    expect(demoCallContext().disclosureVariant).toBe("named");
    expect(demoCallContext().disclosure).toContain("Maya");
    vi.unstubAllEnvs();
    expect(demoCallContext().disclosureVariant).toBe("default");
  });

  it("variant=named prefers DEMO_SPOKEN_NAME when the rig sets one", () => {
    vi.stubEnv("DEMO_SPOKEN_NAME", "Maya");
    expect(demoCallContext("named").disclosure).toContain("Maya");
  });
});

describe("finding 4 (PR #106) — outcome-first salience, deliverability as rail", () => {
  it("the brief LEADS outcome-first and keeps deliverability last", () => {
    const ctx = demoCallContext("named");
    // The system prompt renders talking points top-down — the first one is
    // the story the model opens with (measured on the re-demo).
    const prompt = ctx.systemPrompt;
    const firstPoint = prompt.indexOf("give the agent a goal");
    const railPoint = prompt.indexOf("Supporting rail, not the pitch");
    expect(firstPoint).toBeGreaterThan(-1);
    expect(railPoint).toBeGreaterThan(firstPoint);
    expect(prompt).toContain("goal-first orchestration");
    // Deliverability terms never appear before the outcome-first opener.
    for (const term of ["sender health", "warmup", "suppression"]) {
      const at = prompt.toLowerCase().indexOf(term);
      expect(at === -1 || at > firstPoint).toBe(true);
    }
  });
});
