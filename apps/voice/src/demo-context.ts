/**
 * Standalone fixture context (P3.1) — the certification harness and the CI
 * demo rig run the PRODUCTION session code without a database. The brief and
 * business facts mirror the spike's demo scenario; the disclosure is the
 * locked constant, variant chosen by the same resolution chain the product
 * uses (DEMO_SPOKEN_NAME simulates a confirmed agent name so the demo call
 * can prove BOTH variants).
 */
import {
  buildVoiceSystemPrompt,
  deriveCallBrief,
  buildCachedContext,
} from "@clientforce/channels";
import {
  renderVoiceDisclosure,
  resolveSpokenName,
  voicePersonaById,
} from "@clientforce/core";
import type { CallContext } from "./runtime";

export function demoCallContext(): CallContext {
  const businessName = process.env.DEMO_BUSINESS_NAME ?? "Clientforce";
  const spokenNameEnv = process.env.DEMO_SPOKEN_NAME?.trim();
  const resolved = resolveSpokenName(
    spokenNameEnv ? { spokenName: spokenNameEnv, spokenNameConfirmed: true } : null,
    null,
  );
  const persona = voicePersonaById(process.env.DEMO_VOICE_PERSONA);

  const contextFacts = [
    "Offer: an AI agent platform that runs outreach across email, SMS and voice",
    "USP: sender health, warmup and suppression handled automatically end to end",
    "Setup takes under a day and the team needs no training",
    "Proof point: hundreds of small businesses run their outreach on it",
  ];
  const brief = deriveCallBrief({
    goal: "book_appointments",
    goalLabel: "Gauge interest in a product demo and offer to book a 20-minute call",
    contextFacts,
    neverSay: ["limited time"],
  });
  const neverSay = brief.neverSay ?? [];

  return {
    callId: "demo",
    workspaceId: "demo",
    campaignId: "demo",
    agentId: "demo",
    contactId: "demo",
    enrollmentId: null,
    providerCallSid: "demo",
    systemPrompt: buildVoiceSystemPrompt({
      brief,
      cachedContext: buildCachedContext({
        contextText: contextFacts.map((f) => `- ${f}`).join("\n"),
        toneHints: "warm, curious, low-pressure",
      }),
      neverSay,
      lead: { firstName: null, lastName: null, company: null },
      businessName,
      spokenName: resolved.spokenName,
    }),
    disclosure: renderVoiceDisclosure({
      spokenName: resolved.spokenName,
      businessName,
      // Certification runs use the without-recording branch (default OFF).
      recordingEnabled: false,
    }),
    disclosureVariant: resolved.spokenName ? "named" : "default",
    spokenNameSource: resolved.source,
    neverSay,
    ttsModel: persona.ttsModel,
    language: "en",
    mustSay: brief.mustSay ?? [],
  };
}
