/**
 * Transcript persistence (P3.1) — the A6 mapping is pure and the idempotency
 * key is deterministic per (call, position): a retried finalize can never
 * duplicate rows (`providerMessageId` unique + skipDuplicates).
 */
import { describe, expect, it } from "vitest";
import { rowsFromTranscript } from "../src/persist";
import type { VoiceTurn } from "../src/session";

const target = {
  workspaceId: "ws1",
  campaignId: "c1",
  contactId: "ct1",
  enrollmentId: null,
  callId: "call1",
  providerCallSid: "CA123",
  startedAt: new Date("2026-07-14T12:00:00Z"),
};

const turns: VoiceTurn[] = [
  { role: "assistant", content: "Hi, this is an AI assistant…", atMs: 0 },
  { role: "user", content: "who is this?", atMs: 4000, commitSource: "speech_final" },
  { role: "assistant", content: "Happy to explain.", atMs: 5100 },
  { role: "user", content: "", atMs: 6000 }, // empty — dropped
  { role: "assistant", content: "Sorry, let me put that differently…", atMs: 7000, refusalReason: "NEVER_SAY_VIOLATION" },
];

describe("rowsFromTranscript", () => {
  it("maps caller turns INBOUND, agent turns OUTBOUND, all channel voice", () => {
    const rows = rowsFromTranscript(turns, target);
    expect(rows).toHaveLength(4); // the empty turn is dropped
    expect(rows.map((r) => r.direction)).toEqual(["OUTBOUND", "INBOUND", "OUTBOUND", "OUTBOUND"]);
    expect(rows.every((r) => r.channel === "voice")).toBe(true);
    expect(rows.every((r) => r.workspaceId === "ws1")).toBe(true);
  });

  it("providerMessageId is deterministic per (callSid, position) — the idempotency key", () => {
    const first = rowsFromTranscript(turns, target);
    const second = rowsFromTranscript(turns, target);
    expect(first.map((r) => r.providerMessageId)).toEqual(second.map((r) => r.providerMessageId));
    expect(first[0]!.providerMessageId).toBe("voice:CA123:0");
    expect(new Set(first.map((r) => r.providerMessageId)).size).toBe(first.length);
  });

  it("timestamps ride the turn offsets; meta carries callId, composer stamp, and refusals", () => {
    const rows = rowsFromTranscript(turns, target);
    expect(rows[1]!.sentAt.toISOString()).toBe("2026-07-14T12:00:04.000Z");
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta.callId).toBe("call1");
    expect(meta.composerVersion).toBe("composer.voice@v1");
    const inboundMeta = rows[1]!.meta as Record<string, unknown>;
    expect(inboundMeta.composerVersion).toBeUndefined(); // caller words aren't composed
    expect(inboundMeta.commitSource).toBe("speech_final");
    const refusedMeta = rows[3]!.meta as Record<string, unknown>;
    expect(refusedMeta.refusalReason).toBe("NEVER_SAY_VIOLATION");
  });
});
