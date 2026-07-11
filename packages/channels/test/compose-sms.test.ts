/**
 * G1 (DEC-068) composer unit tests — pure, no infra. The deterministic checks
 * are string operations proven one by one; composeSms's bounded retry walks
 * clean-first-pass / retry-heals / retry-still-dirty → typed refusal, with a
 * prompt-driven fake provider (the M1a fixture pattern — no network, ever).
 */
import { describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import {
  checkComposedSms,
  ComposeRefusedError,
  composeSms,
  COMPOSER_SYSTEM,
  COMPOSER_VERSION,
  SMS_COMPOSE_MAX_CHARS,
  type ComposeSmsInputs,
} from "../src/compose-sms";

const inputs = (over: Partial<ComposeSmsInputs> = {}): ComposeSmsInputs => ({
  brief: {
    objective: "Earn a reply about the audit",
    talkingPoints: [
      "free growth audit shows where bookings leak",
      "results in 7 days",
      "book at https://clientforce.io/audit",
    ],
    mustSay: ["free growth audit"],
    neverSay: ["limited time"],
  },
  cachedContext:
    "BUSINESS CONTEXT:\n- offer: We book dental appointments with a free growth audit at https://clientforce.io/audit.",
  neverSay: ["rock-bottom prices", "limited time"],
  lead: { firstName: "Jane", lastName: "Doe", company: "Acme Dental" },
  history: [],
  firstTouch: true,
  ...over,
});

const CLEAN =
  "Jane, most Acme Dental bookings still come by phone — our free growth audit shows where they leak. Worth a look?";

describe("checkComposedSms (deterministic — every check is a string operation)", () => {
  it("passes clean, grounded, personalized copy", () => {
    expect(checkComposedSms(CLEAN, inputs())).toEqual([]);
  });

  it("names every banned phrase from BOTH lists (agent strategy ∪ brief)", () => {
    const v = checkComposedSms(
      "Rock-Bottom Prices for a LIMITED TIME, Jane — free growth audit.",
      inputs(),
    );
    expect(v.map((x) => x.reason)).toContain("NEVER_SAY_VIOLATION");
    const hit = v.find((x) => x.reason === "NEVER_SAY_VIOLATION")!;
    expect(hit.detail).toContain('"rock-bottom prices"'); // case-insensitive
    expect(hit.detail).toContain('"limited time"');
  });

  it("requires every mustSay string (case-insensitive)", () => {
    const v = checkComposedSms("Jane, quick question about Acme Dental?", inputs());
    expect(v.map((x) => x.reason)).toContain("MUST_SAY_MISSING");
    expect(v.find((x) => x.reason === "MUST_SAY_MISSING")!.detail).toContain(
      '"free growth audit"',
    );
    // Different casing satisfies it.
    expect(
      checkComposedSms("Jane — our FREE GROWTH AUDIT finds the leaks. Interested?", inputs()),
    ).toEqual([]);
  });

  it(`enforces the ${SMS_COMPOSE_MAX_CHARS}-char hard cap`, () => {
    const long = `free growth audit ${"x".repeat(SMS_COMPOSE_MAX_CHARS)}`;
    const v = checkComposedSms(long, inputs());
    expect(v.map((x) => x.reason)).toContain("TOO_LONG");
  });

  it("rejects ANY merge-token syntax — composed text is finished copy", () => {
    const v = checkComposedSms("Hi {{firstName}}, free growth audit for you?", inputs());
    expect(v.map((x) => x.reason)).toContain("TOKEN_SYNTAX");
    expect(v.find((x) => x.reason === "TOKEN_SYNTAX")!.detail).toContain("{{firstName}}");
  });

  it("rejects URLs absent from the context/brief; allows grounded ones", () => {
    const foreign = checkComposedSms(
      "Jane — free growth audit at https://evil.example/win. Interested?",
      inputs(),
    );
    expect(foreign.map((x) => x.reason)).toContain("UNGROUNDED_URL");
    expect(foreign.find((x) => x.reason === "UNGROUNDED_URL")!.detail).toContain(
      "https://evil.example/win",
    );
    // The audit link appears in the brief + context → allowed (trailing
    // punctuation on the composed URL doesn't defeat the match).
    expect(
      checkComposedSms(
        "Jane — free growth audit: https://clientforce.io/audit. Worth a look?",
        inputs(),
      ),
    ).toEqual([]);
  });
});

/** Prompt-driven fake: emits per configured script; records every call. */
function fakeGateway(bodies: string[]) {
  const calls: Array<{ prompt: string; system?: string; cachedContext?: string }> = [];
  const gateway = new AiGateway({
    provider: {
      completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
      completeTool: async (params: { prompt: string; system?: string; cachedContext?: string }) => {
        calls.push({
          prompt: params.prompt,
          system: params.system,
          cachedContext: params.cachedContext,
        });
        return {
          input: { body: bodies[Math.min(calls.length - 1, bodies.length - 1)] },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
    config: { maxRetries: 0 },
  });
  return { gateway, calls };
}

describe("composeSms (bounded retry → typed refusal)", () => {
  it("clean first pass: one model call, composer version recorded", async () => {
    const { gateway, calls } = fakeGateway([CLEAN]);
    const out = await composeSms(gateway, inputs());
    expect(out).toMatchObject({ body: CLEAN, composerVersion: COMPOSER_VERSION, attempts: 1 });
    expect(calls).toHaveLength(1);
    // The static system + the cacheable per-agent context ride every call.
    expect(calls[0]!.system).toBe(COMPOSER_SYSTEM);
    expect(calls[0]!.cachedContext).toContain("BUSINESS CONTEXT");
    // Per-lead material lives in the user prompt, never the cached block.
    expect(calls[0]!.prompt).toContain("Jane");
    expect(calls[0]!.cachedContext).not.toContain("Jane");
  });

  it("dirty first pass → the retry prompt names the violations → clean retry wins", async () => {
    const dirty = "Jane, rock-bottom prices on the free growth audit!";
    const { gateway, calls } = fakeGateway([dirty, CLEAN]);
    const out = await composeSms(gateway, inputs());
    expect(out.attempts).toBe(2);
    expect(out.body).toBe(CLEAN);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain("FAILED its checks");
    expect(calls[1]!.prompt).toContain('"rock-bottom prices"');
    expect(calls[1]!.prompt).toContain(dirty); // the model sees its own text
  });

  it("still dirty after the retry → ComposeRefusedError with the typed reason", async () => {
    const dirty = "Jane, rock-bottom prices forever.";
    const { gateway, calls } = fakeGateway([dirty, dirty]);
    const err = await composeSms(gateway, inputs()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposeRefusedError);
    expect((err as ComposeRefusedError).reason).toBe("NEVER_SAY_VIOLATION");
    expect((err as ComposeRefusedError).detail).toContain('"rock-bottom prices"');
    expect(calls).toHaveLength(2); // exactly ONE bounded retry, never more
  });

  it("first-touch constraint rides the prompt (opt-out headroom note)", async () => {
    const { gateway, calls } = fakeGateway([CLEAN]);
    await composeSms(gateway, inputs({ firstTouch: true }));
    expect(calls[0]!.prompt).toContain("Reply STOP to opt out.");
    const { gateway: g2, calls: c2 } = fakeGateway([CLEAN]);
    await composeSms(g2, inputs({ firstTouch: false, history: [{ channel: "sms", direction: "OUTBOUND", text: "hi" }] }));
    expect(c2[0]!.prompt).toContain("continues an existing thread");
    expect(c2[0]!.prompt).toContain("[sms · we sent] hi");
  });
});
