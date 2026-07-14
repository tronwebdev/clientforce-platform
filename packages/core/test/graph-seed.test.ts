/**
 * W3-4 W2 (DEC-076): deriveBriefSeed — deterministic scripted→guided seeding.
 * The scripted step's own copy becomes the editable seed; nothing is
 * fabricated (a thin body yields complete:false and the editor's min-3 floor
 * holds the honest gate).
 */
import { describe, expect, it } from "vitest";
import { arcRoleAt, deriveBriefSeed, stepBriefSchema, type StepNode } from "../src/index";

const step = (over: Partial<StepNode["content"]>, channel: "email" | "sms" = "email"): StepNode => ({
  id: "s1",
  type: "step",
  channel,
  content: { subject: "Quick idea for {{company}}", body: "", ...over },
});

const RICH_BODY = [
  "Hi {{firstName}},",
  "Most dental practices lose 30% of bookings to phone tag. Our online scheduler fills those gaps automatically.",
  "Clients see 12 extra bookings a month on average. Setup takes one 20-minute call.",
  "Best,\n{{senderName}}",
].join("\n");

describe("deriveBriefSeed", () => {
  it("derives subjectHint from the subject and talking points from body sentences", () => {
    const seed = deriveBriefSeed(step({ body: RICH_BODY }));
    expect(seed.subjectHint).toBe("Quick idea for their company");
    expect(seed.talkingPoints.length).toBeGreaterThanOrEqual(3);
    expect(seed.complete).toBe(true);
    // greetings/signoffs never become talking points
    expect(seed.talkingPoints.some((p) => p.toLowerCase().startsWith("hi"))).toBe(false);
    expect(seed.talkingPoints.some((p) => p.toLowerCase().startsWith("best"))).toBe(false);
  });

  it("resolves merge tokens neutrally — bullets read as prose, never raw tokens", () => {
    const seed = deriveBriefSeed(step({ body: "One more thought for {{company}} that could help {{firstName}} this quarter." }));
    expect(seed.talkingPoints[0]).toBe("One more thought for their company that could help the lead this quarter.");
    expect(JSON.stringify(seed)).not.toContain("{{");
  });

  it("uses the arc role as the objective when given; falls back to the subject", () => {
    const role = "OPENER — name a pain this ideal customer actually feels, ask exactly one question about it";
    expect(deriveBriefSeed(step({ body: RICH_BODY }), role).objective).toBe(role);
    expect(deriveBriefSeed(step({ body: RICH_BODY })).objective).toBe("Get a reply about: Quick idea for their company");
  });

  it("a thin body seeds an INCOMPLETE brief — nothing is fabricated to fill it", () => {
    const seed = deriveBriefSeed(step({ body: "Hi {{firstName}}, quick nudge." }));
    expect(seed.complete).toBe(false);
    expect(seed.talkingPoints.length).toBeLessThan(3);
  });

  it("sms steps never seed a subjectHint; caps respect the brief schema", () => {
    const seed = deriveBriefSeed(step({ subject: undefined, body: RICH_BODY }, "sms"));
    expect(seed.subjectHint).toBeUndefined();
    const complete = deriveBriefSeed(step({ body: RICH_BODY }));
    // A complete seed parses through the REAL brief schema (what the staged
    // compose + the eventual save both validate against).
    expect(() =>
      stepBriefSchema.parse({
        objective: complete.objective,
        talkingPoints: complete.talkingPoints,
        ...(complete.subjectHint ? { subjectHint: complete.subjectHint } : {}),
      }),
    ).not.toThrow();
  });

  it("arcRoleAt mirrors the channels position mapping (first/interior/last)", () => {
    const roles = ["OPENER", "VALUE", "PREEMPT", "BREAKUP"];
    expect(arcRoleAt(roles, 1, 4)).toBe("OPENER");
    expect(arcRoleAt(roles, 2, 4)).toBe("VALUE");
    expect(arcRoleAt(roles, 3, 4)).toBe("PREEMPT");
    expect(arcRoleAt(roles, 4, 4)).toBe("BREAKUP");
    expect(arcRoleAt(roles, 2, 6)).toBe("VALUE");
    expect(arcRoleAt(roles, 5, 6)).toBe("PREEMPT");
    expect(arcRoleAt([], 1, 1)).toBeUndefined();
  });
});
