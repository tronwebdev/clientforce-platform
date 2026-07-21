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

/**
 * @param variant demo disclosure variant riding the TwiML stream parameter
 *   (`named` | `default`) — a DEPLOYED container can't flip env between
 *   dials. Any other/absent value falls back to the DEMO_SPOKEN_NAME env
 *   (the runner rig + certification harness path, unchanged).
 */
export function demoCallContext(variant?: string): CallContext {
  const businessName = process.env.DEMO_BUSINESS_NAME ?? "Clientforce";
  const spokenNameEnv =
    variant === "named"
      ? (process.env.DEMO_SPOKEN_NAME?.trim() || "Ava")
      : variant === "default"
        ? undefined
        : process.env.DEMO_SPOKEN_NAME?.trim();
  const resolved = resolveSpokenName(
    spokenNameEnv ? { spokenName: spokenNameEnv, spokenNameConfirmed: true } : null,
    null,
  );
  const persona = voicePersonaById(process.env.DEMO_VOICE_PERSONA);

  // Owner finding 4 (PR #106, 2026-07-21): the demo content leads OUTCOME-
  // first — goal in → the agent orchestrates the play → outcome out.
  // Deliverability/compliance are a supporting rail, never the opener. Order
  // IS salience here: talking points and the context block both render
  // top-down into the system prompt (the model leads with what it reads
  // first — measured on the re-demo, where it opened with deliverability).
  // Q-047 tracks deriving this positioning summary at ingestion product-wide.
  const contextFacts = [
    "Offer: give the agent a goal — like booked appointments — and it runs the whole play: prospecting, outreach across email, SMS and voice, reading intent, and booking the outcome",
    "How it lands: a goal goes in and outcomes come out — the agent orchestrates the channels and integrations so the team isn't operating tools",
    "Setup takes under a day and the team needs no training",
    "Proof point: hundreds of small businesses run their outreach on it",
    "Supporting rail, not the pitch: sender health, warmup, suppression and compliance are handled automatically underneath",
  ];
  const brief = deriveCallBrief({
    goal: "book_appointments",
    goalLabel: "Show what goal-first orchestration does for their outreach, gauge interest, and offer to book a 20-minute demo",
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
