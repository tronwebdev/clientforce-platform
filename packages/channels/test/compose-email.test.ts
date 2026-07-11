/**
 * G2 (DEC-071) email-composer unit tests — pure, no infra. The deterministic
 * checks are string operations proven one by one (the G1 set on subject+body
 * PLUS the email rails: subject rules and the composed-footer ban);
 * composeEmail's bounded retry walks clean-first-pass / retry-heals /
 * retry-still-dirty → typed refusal, with a prompt-driven fake provider
 * (the M1a fixture pattern — no network, ever).
 */
import { describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { STRATEGY_ARCS } from "@clientforce/core";
import {
  arcRoleFor,
  checkComposedEmail,
  ComposeRefusedError,
  composeEmail,
  COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE,
  COMPOSER_EMAIL_SYSTEM,
  COMPOSER_EMAIL_VERSION,
  composerEmailVersionFor,
  EMAIL_COMPOSE_MAX_WORDS,
  EMAIL_SUBJECT_MAX_CHARS,
  type ComposeEmailInputs,
} from "../src/compose-email";

const inputs = (over: Partial<ComposeEmailInputs> = {}): ComposeEmailInputs => ({
  brief: {
    objective: "Earn a reply about the audit",
    talkingPoints: [
      "free growth audit shows where bookings leak",
      "results in 7 days",
      "book at https://clientforce.io/audit",
    ],
    mustSay: ["free growth audit"],
    neverSay: ["limited time"],
    subjectHint: "where phone-only booking leaks patients",
  },
  cachedContext:
    "BUSINESS CONTEXT:\n- offer: We book dental appointments with a free growth audit at https://clientforce.io/audit.",
  neverSay: ["rock-bottom prices", "limited time"],
  lead: { firstName: "Jane", lastName: "Doe", company: "Acme Dental" },
  history: [],
  arcRole: {
    index: 1,
    count: 3,
    role: STRATEGY_ARCS.diagnose_prescribe.roles[0]!,
  },
  ...over,
});

const CLEAN_SUBJECT = "Where Acme Dental bookings leak";
const CLEAN_BODY =
  "Jane, most Acme Dental bookings still come by phone — our free growth audit shows where they leak. Worth a look?";

describe("checkComposedEmail (deterministic — the G1 set on subject+body)", () => {
  it("passes clean, grounded, personalized copy", () => {
    expect(checkComposedEmail(CLEAN_SUBJECT, CLEAN_BODY, inputs())).toEqual([]);
  });

  it("names banned phrases from BOTH lists, in subject OR body", () => {
    const inBody = checkComposedEmail(
      CLEAN_SUBJECT,
      "Rock-Bottom Prices, Jane — free growth audit.",
      inputs(),
    );
    expect(inBody.map((x) => x.reason)).toContain("NEVER_SAY_VIOLATION");
    expect(inBody.find((x) => x.reason === "NEVER_SAY_VIOLATION")!.detail).toContain(
      '"rock-bottom prices"',
    );
    const inSubject = checkComposedEmail("Limited time audit offer", CLEAN_BODY, inputs());
    expect(inSubject.map((x) => x.reason)).toContain("NEVER_SAY_VIOLATION");
  });

  it("requires every mustSay string (case-insensitive, subject or body)", () => {
    const v = checkComposedEmail(CLEAN_SUBJECT, "Jane, a note about Acme Dental.", inputs());
    expect(v.map((x) => x.reason)).toContain("MUST_SAY_MISSING");
    // A subject can satisfy it too.
    expect(
      checkComposedEmail("Your free growth audit", "Jane — the leaks are fixable. Worth a look?", inputs()),
    ).toEqual([]);
  });

  it(`enforces the ${EMAIL_COMPOSE_MAX_WORDS}-word body hard cap (the planner's email literal)`, () => {
    const long = `free growth audit ${"word ".repeat(EMAIL_COMPOSE_MAX_WORDS)}`;
    const v = checkComposedEmail(CLEAN_SUBJECT, long, inputs());
    expect(v.map((x) => x.reason)).toContain("TOO_LONG");
    expect(v.find((x) => x.reason === "TOO_LONG")!.detail).toContain(`${EMAIL_COMPOSE_MAX_WORDS}`);
  });

  it("rejects ANY merge-token syntax in subject or body — composed text is finished copy", () => {
    expect(
      checkComposedEmail(CLEAN_SUBJECT, "Hi {{firstName}}, free growth audit?", inputs()).map((x) => x.reason),
    ).toContain("TOKEN_SYNTAX");
    expect(
      checkComposedEmail("{{company}} bookings leak", CLEAN_BODY, inputs()).map((x) => x.reason),
    ).toContain("TOKEN_SYNTAX");
  });

  it("rejects URLs absent from the context/brief; allows grounded ones (subjectHint counts as material)", () => {
    const foreign = checkComposedEmail(
      CLEAN_SUBJECT,
      "Jane — free growth audit at https://evil.example/win. Worth a look?",
      inputs(),
    );
    expect(foreign.map((x) => x.reason)).toContain("UNGROUNDED_URL");
    expect(
      checkComposedEmail(
        CLEAN_SUBJECT,
        "Jane — free growth audit: https://clientforce.io/audit. Worth a look?",
        inputs(),
      ),
    ).toEqual([]);
  });
});

describe("checkComposedEmail — the email-specific rails (G2)", () => {
  it("SUBJECT_RULE: empty subject", () => {
    const v = checkComposedEmail("", CLEAN_BODY, inputs());
    expect(v.map((x) => x.reason)).toContain("SUBJECT_RULE");
    expect(v.find((x) => x.reason === "SUBJECT_RULE")!.detail).toContain("empty");
  });

  it(`SUBJECT_RULE: over the ${EMAIL_SUBJECT_MAX_CHARS}-char cap`, () => {
    const v = checkComposedEmail(
      "free growth audit " + "x".repeat(EMAIL_SUBJECT_MAX_CHARS),
      CLEAN_BODY,
      inputs(),
    );
    expect(v.map((x) => x.reason)).toContain("SUBJECT_RULE");
  });

  it("SUBJECT_RULE: exclamation marks and ALL CAPS (the playbook literals)", () => {
    expect(
      checkComposedEmail("Your audit is ready!", CLEAN_BODY, inputs()).map((x) => x.reason),
    ).toContain("SUBJECT_RULE");
    expect(
      checkComposedEmail("FREE GROWTH AUDIT", CLEAN_BODY, inputs()).map((x) => x.reason),
    ).toContain("SUBJECT_RULE");
  });

  it('SUBJECT_RULE: faux "Re:"/"Fwd:" prefixes — threading is the boundary\'s job (owner rule 3)', () => {
    const v = checkComposedEmail("Re: your bookings", CLEAN_BODY, inputs());
    expect(v.map((x) => x.reason)).toContain("SUBJECT_RULE");
    expect(v.find((x) => x.reason === "SUBJECT_RULE")!.detail).toContain("Re:");
  });

  it('SUBJECT_RULE: the playbook banned patterns ("quick question" + the opener list), any casing', () => {
    const quick = checkComposedEmail("Quick Question about Acme", CLEAN_BODY, inputs());
    expect(quick.map((x) => x.reason)).toContain("SUBJECT_RULE");
    expect(quick.find((x) => x.reason === "SUBJECT_RULE")!.detail).toContain('"quick question"');
    expect(
      checkComposedEmail("Just checking in on the audit", CLEAN_BODY, inputs()).map((x) => x.reason),
    ).toContain("SUBJECT_RULE");
  });

  it("COMPOSED_FOOTER: unsubscribe/opt-out/footer language refuses — the footer is the boundary's job, forever", () => {
    for (const dirty of [
      "Jane — free growth audit. Unsubscribe anytime.",
      "Jane — free growth audit. Reply to opt out.",
      "Jane — free growth audit. To stop receiving these, reply.",
      "Jane — free growth audit. I'll remove me from the list if you prefer.",
    ]) {
      const v = checkComposedEmail(CLEAN_SUBJECT, dirty, inputs());
      expect(v.map((x) => x.reason)).toContain("COMPOSED_FOOTER");
    }
    // The clean body carries none of it.
    expect(checkComposedEmail(CLEAN_SUBJECT, CLEAN_BODY, inputs())).toEqual([]);
  });
});

describe("arcRoleFor (M1a ladder — positional, fold rule)", () => {
  const roles = STRATEGY_ARCS.diagnose_prescribe.roles; // OPENER · VALUE · OBJECTION · BREAKUP

  it("first = OPENER, last = BREAKUP — the breakup is never dropped", () => {
    expect(arcRoleFor(roles, { index: 1, count: 4 })).toBe(roles[0]);
    expect(arcRoleFor(roles, { index: 4, count: 4 })).toBe(roles[3]);
    expect(arcRoleFor(roles, { index: 3, count: 3 })).toBe(roles[3]);
  });

  it("middles walk the ladder; a 3-step sequence folds OBJECTION into VALUE", () => {
    expect(arcRoleFor(roles, { index: 2, count: 4 })).toBe(roles[1]);
    expect(arcRoleFor(roles, { index: 3, count: 4 })).toBe(roles[2]);
    expect(arcRoleFor(roles, { index: 2, count: 3 })).toBe(roles[1]); // fold rule
    // Owner-extended sequences never walk off the ladder.
    expect(arcRoleFor(roles, { index: 4, count: 6 })).toBe(roles[2]);
  });
});

/** Prompt-driven fake: emits per configured script; records every call. */
function fakeGateway(outputs: Array<{ subject: string; body: string }>) {
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
          input: outputs[Math.min(calls.length - 1, outputs.length - 1)],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
    config: { maxRetries: 0 },
  });
  return { gateway, calls };
}

const CLEAN = { subject: CLEAN_SUBJECT, body: CLEAN_BODY };

describe("composeEmail (bounded retry → typed refusal)", () => {
  it("clean first pass: one model call, composer version recorded, prompt discipline holds", async () => {
    const { gateway, calls } = fakeGateway([CLEAN]);
    const out = await composeEmail(gateway, inputs());
    expect(out).toMatchObject({
      subject: CLEAN_SUBJECT,
      body: CLEAN_BODY,
      composerVersion: COMPOSER_EMAIL_VERSION,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
    // The static system + the cacheable per-agent context ride every call.
    expect(calls[0]!.system).toBe(COMPOSER_EMAIL_SYSTEM);
    expect(calls[0]!.cachedContext).toContain("BUSINESS CONTEXT");
    // Per-lead material lives in the user prompt, never the cached block.
    expect(calls[0]!.prompt).toContain("Jane");
    expect(calls[0]!.cachedContext).not.toContain("Jane");
    // The arc role + subject hint reached the prompt (arc-role aware).
    expect(calls[0]!.prompt).toContain("step 1 of 3 — OPENER");
    expect(calls[0]!.prompt).toContain("where phone-only booking leaks patients");
  });

  it("threaded inputs adjust the thread note; role-free inputs say so", async () => {
    const { gateway, calls } = fakeGateway([CLEAN]);
    await composeEmail(gateway, inputs({ threaded: true, arcRole: undefined, history: [{ channel: "email", direction: "OUTBOUND", text: "hi" }] }));
    expect(calls[0]!.prompt).toContain("continues an existing email thread");
    expect(calls[0]!.prompt).toContain("(unspecified — write one focused, specific touch)");
    expect(calls[0]!.prompt).toContain("[email · we sent] hi");
  });

  it("dirty first pass → the retry prompt names the violations → clean retry wins", async () => {
    const dirty = { subject: "Quick question!", body: `${CLEAN_BODY} Unsubscribe anytime.` };
    const { gateway, calls } = fakeGateway([dirty, CLEAN]);
    const out = await composeEmail(gateway, inputs());
    expect(out.attempts).toBe(2);
    expect(out.subject).toBe(CLEAN_SUBJECT);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain("FAILED its checks");
    expect(calls[1]!.prompt).toContain("SUBJECT_RULE");
    expect(calls[1]!.prompt).toContain("COMPOSED_FOOTER");
    expect(calls[1]!.prompt).toContain(dirty.subject); // the model sees its own text
  });

  it("still dirty after the retry → ComposeRefusedError with the typed reason; exactly ONE bounded retry", async () => {
    const dirty = { subject: CLEAN_SUBJECT, body: `${CLEAN_BODY} Unsubscribe anytime.` };
    const { gateway, calls } = fakeGateway([dirty, dirty]);
    const err = await composeEmail(gateway, inputs()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposeRefusedError);
    expect((err as ComposeRefusedError).reason).toBe("COMPOSED_FOOTER");
    expect(calls).toHaveLength(2);
  });
});

describe("composer.email language (L1, DEC-072 — v2 for non-English, v1 byte-identical for English)", () => {
  // German subject+body that pass every deterministic check: mustSay quoted
  // verbatim, subject under the cap with no banned pattern, no bans, no
  // tokens, no foreign URLs, no footer language.
  const CLEAN_DE = {
    subject: "wo Termine bei Acme Dental verloren gehen",
    body: "Jane, die meisten Termine bei Acme Dental kommen noch telefonisch — unser free growth audit zeigt, wo sie verloren gehen. Kurz ansehen?",
  };

  it("GERMAN agent: the v2 prompt carries the language directive; provenance is @v2 (a German GUIDED agent never composes English bodies over a German footer)", async () => {
    const { gateway, calls } = fakeGateway([CLEAN_DE]);
    const out = await composeEmail(gateway, inputs({ language: "de" }));
    expect(out.subject).toBe(CLEAN_DE.subject);
    expect(out.body).toBe(CLEAN_DE.body);
    expect(out.composerVersion).toBe(`composer.email@v${COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE}`);
    expect(out.composerVersion).toBe(composerEmailVersionFor("de"));
    // The v2 constraint line — subject AND body in the agent's language.
    expect(calls[0]!.prompt).toContain(
      "Write the ENTIRE email — subject AND body — in German (Deutsch); the lead reads German (Deutsch).",
    );
    // The deterministic checks run the same regardless of language.
    expect(checkComposedEmail(CLEAN_DE.subject, CLEAN_DE.body, inputs({ language: "de" }))).toEqual([]);
  });

  it("ENGLISH REGRESSION: absent language and explicit 'en' render the v1 prompt BYTE-IDENTICAL, provenance @v1", async () => {
    const { gateway, calls } = fakeGateway([CLEAN]);
    const legacy = await composeEmail(gateway, inputs());
    const { gateway: g2, calls: c2 } = fakeGateway([CLEAN]);
    const explicit = await composeEmail(g2, inputs({ language: "en" }));

    expect(c2[0]!.prompt).toBe(calls[0]!.prompt); // byte-identical prompt
    expect(calls[0]!.prompt).not.toContain("Write the ENTIRE email");
    expect(legacy.composerVersion).toBe(COMPOSER_EMAIL_VERSION);
    expect(explicit.composerVersion).toBe(COMPOSER_EMAIL_VERSION);
    expect(composerEmailVersionFor("en")).toBe(COMPOSER_EMAIL_VERSION);
  });
});
