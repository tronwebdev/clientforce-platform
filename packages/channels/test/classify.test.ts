/**
 * Classifier v2 (M1b, DEC-068) — pure unit tests, no infra: the emission set
 * is bounded to the shared enum, every emission label has a pinned fixture,
 * the v2 prompt carries every label + the boundary rules, v1 stays registered
 * verbatim (append-only registry), and an out-of-set label from the model is
 * REJECTED by the structured-output schema — no free agency.
 */
import { describe, expect, it } from "vitest";
import { AiGateway, renderPrompt } from "@clientforce/ai";
import { IntentSchema } from "@clientforce/events";
import { classifyReply, CLASSIFY_EMISSION_LABELS, CLASSIFY_PROMPT_NAME } from "../src/classify";
import {
  MULTILINGUAL_REPLY_FIXTURES,
  REPLY_INTENT_FIXTURES,
  fixtureFor,
} from "../src/classify-fixtures";

/** Fake gateway that emits a fixed label and captures the system prompt. */
function fakeGateway(label: string, capture: { system?: string } = {}) {
  return new AiGateway({
    provider: {
      completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
      completeTool: async (params: { system?: string }) => {
        capture.system = params.system;
        return { input: { intent: label }, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    },
    embeddings: {
      embed: async (texts: string[]) => ({
        vectors: texts.map(() => [0]),
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    },
    config: { maxRetries: 0 },
  });
}

const ctx = { goal: "book_appointments", replyText: "hello", engagement: [] };

describe("classifier v2 emission set (DEC-068)", () => {
  it("every emission label is a member of the ONE shared IntentSchema (no fork)", () => {
    for (const label of CLASSIFY_EMISSION_LABELS) {
      expect(IntentSchema.safeParse(label).success, label).toBe(true);
    }
  });

  it("covers exactly the six strategy intents + replied/ooo/unsubscribe; legacy labels retired from emission", () => {
    expect([...CLASSIFY_EMISSION_LABELS].sort()).toEqual(
      [
        "interested",
        "objection_price",
        "objection_timing",
        "wrong_person",
        "info_request",
        "not_interested",
        "replied",
        "ooo",
        "unsubscribe",
      ].sort(),
    );
    for (const legacy of ["booked", "question", "not"]) {
      expect(CLASSIFY_EMISSION_LABELS).not.toContain(legacy);
    }
  });

  it("has exactly one pinned fixture per emission label (the contract, both directions)", () => {
    expect(REPLY_INTENT_FIXTURES).toHaveLength(CLASSIFY_EMISSION_LABELS.length);
    for (const label of CLASSIFY_EMISSION_LABELS) {
      expect(fixtureFor(label).reply.length).toBeGreaterThan(0);
    }
    for (const f of REPLY_INTENT_FIXTURES) {
      expect(CLASSIFY_EMISSION_LABELS).toContain(f.intent);
    }
  });
});

describe("classifier prompt v2 (append-only registry)", () => {
  it("the v2 system prompt names every emission label and the boundary rules", async () => {
    const capture: { system?: string } = {};
    await classifyReply(fakeGateway("interested", capture), ctx);
    const system = capture.system ?? "";
    for (const label of CLASSIFY_EMISSION_LABELS) {
      expect(system).toContain(`"${label}"`);
    }
    // The disambiguation rules that make six intents classifiable.
    expect(system).toContain('a decline that also demands removal is "unsubscribe"');
    expect(system).toContain('"Too expensive" is "objection_price" even when phrased as a decline');
    expect(system).toContain('an automatic away-message is "ooo"');
    // Retired labels are not offered to the model.
    expect(system).not.toContain('"booked"');
    expect(system).not.toContain('"question"');
    expect(system).not.toContain('- "not":');
  });

  it("v1 stays registered VERBATIM beside v2 (prompts are append-only code)", async () => {
    await classifyReply(fakeGateway("interested"), ctx); // ensures registration ran
    const v1 = renderPrompt(CLASSIFY_PROMPT_NAME, 1, {});
    expect(v1).toContain('"booked": explicitly accepts or confirms a specific meeting/time.');
    expect(v1).toContain('"not": declines / not interested');
    expect(v1).not.toContain("objection_price");
  });

  it("an out-of-set label from the model is rejected by the schema — bounded choice, no free agency", async () => {
    // "booked" is a valid Intent but NOT a v2 emission label: the structured
    // output schema refuses it (one bounded repair, then a typed failure).
    await expect(classifyReply(fakeGateway("booked"), ctx)).rejects.toThrow();
    await expect(classifyReply(fakeGateway("maybe"), ctx)).rejects.toThrow();
  });

  it("each strategy intent round-trips through classifyReply (plumbing per label)", async () => {
    for (const f of REPLY_INTENT_FIXTURES) {
      const intent = await classifyReply(fakeGateway(f.intent), {
        ...ctx,
        replyText: f.reply,
      });
      expect(intent).toBe(f.intent);
    }
  });
});

describe("multilingual pins (L1, DEC-071 — NO classifier code change)", () => {
  it("every multilingual fixture pins an emission label and a launch language", () => {
    expect(MULTILINGUAL_REPLY_FIXTURES.length).toBeGreaterThanOrEqual(2);
    expect(MULTILINGUAL_REPLY_FIXTURES.map((f) => f.language).sort()).toEqual(["de", "fr"]);
    for (const f of MULTILINGUAL_REPLY_FIXTURES) {
      expect(CLASSIFY_EMISSION_LABELS).toContain(f.intent);
      expect(f.reply.length).toBeGreaterThan(0);
      // Separate constant on purpose — the M1b matrix stays one-per-label.
      expect(REPLY_INTENT_FIXTURES.map((r) => r.reply)).not.toContain(f.reply);
    }
  });

  it("a German and a French reply round-trip classifyReply UNCHANGED (same plumbing, same enum)", async () => {
    for (const f of MULTILINGUAL_REPLY_FIXTURES) {
      const intent = await classifyReply(fakeGateway(f.intent), {
        ...ctx,
        replyText: f.reply,
      });
      expect(intent).toBe(f.intent);
    }
  });
});
