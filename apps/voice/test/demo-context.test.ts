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
