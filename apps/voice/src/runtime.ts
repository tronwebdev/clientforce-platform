/**
 * Call runtime (P3.1, DEC-078) — everything around one CallSession: load the
 * call's context through the RLS-subject client, resolve the spoken name via
 * the locked chain, render the locked disclosure, build the composer.voice@v1
 * system prompt, then persist + finalize + emit events when the stream ends.
 *
 * Standalone mode (no DATABASE_URL): the certification harness and the CI
 * demo rig run the SAME session code against a fixture context — no
 * persistence, loudly logged. The product path (API-dialed, callId bound via
 * the Twilio stream parameter) always persists.
 */
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  buildCachedContext,
  buildVoiceSystemPrompt,
  deriveCallBrief,
  strategyOf,
  type ComposeVoiceInputs,
} from "@clientforce/channels";
import { loadMergedContextText } from "@clientforce/context";
import {
  parseGuardrails,
  parseWorkspaceVoiceDefaults,
  renderVoiceDisclosure,
  resolveSpokenName,
  voicePersonaById,
  type LanguageCode,
} from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import type { VoiceEventsPublisher } from "./events";
import type { MetricsCollector } from "./metrics";
import { persistTranscript } from "./persist";
import type { CallEndReason, VoiceTurn } from "./session";
import { mustSayCoverage } from "@clientforce/channels";

export interface CallContext {
  callId: string;
  workspaceId: string;
  campaignId: string;
  agentId: string;
  contactId: string;
  enrollmentId: string | null;
  providerCallSid: string;
  systemPrompt: string;
  disclosure: string;
  disclosureVariant: "named" | "default";
  spokenNameSource: string;
  neverSay: string[];
  ttsModel: string;
  language: LanguageCode;
  mustSay: string[];
}

/**
 * Load one call's full context by callId. The Call row was created by the
 * api's dial endpoint AFTER the rails cleared; workspaceId travels alongside
 * callId in the Twilio stream parameters because the RLS GUC needs it before
 * any tenant-scoped read can happen.
 */
export async function loadCallContextScoped(
  prisma: PrismaClient,
  workspaceId: string,
  callId: string,
): Promise<CallContext> {
  const ctx = { workspaceId };
  const call = await withTenant(prisma, ctx, (tx) => tx.call.findUnique({ where: { id: callId } }));
  if (!call || call.workspaceId !== workspaceId) throw new Error(`Call ${callId} not found`);

  const [agent, contact, workspace, contextText] = await Promise.all([
    withTenant(prisma, ctx, (tx) => tx.agent.findUnique({ where: { id: call.agentId } })),
    withTenant(prisma, ctx, (tx) => tx.contact.findUnique({ where: { id: call.contactId } })),
    withTenant(prisma, ctx, (tx) => tx.workspace.findUnique({ where: { id: workspaceId } })),
    loadMergedContextText(prisma, { workspaceId, agentId: call.agentId }),
  ]);
  if (!agent) throw new Error(`Agent ${call.agentId} not found`);
  if (!contact) throw new Error(`Contact ${call.contactId} not found`);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const guardrails = parseGuardrails(agent.guardrails);
  const strategy = strategyOf(agent.goal, agent.category, agent.guardrails);
  const voiceDefaults = parseWorkspaceVoiceDefaults(workspace.settings);
  const resolved = resolveSpokenName(guardrails.voice ?? null, voiceDefaults);
  const persona = voicePersonaById(guardrails.voice?.voicePersonaId);
  // D9 (implementation note for the DEC): there is no business-name context
  // field — the workspace's name IS the tenant business name.
  const businessName = workspace.name;

  const brief = deriveCallBrief({
    goal: agent.goal,
    goalLabel: guardrails.goalLabel,
    strategyNotes: strategy.strategyNotes,
    contextFacts: contextText.split("\n").map((l) => l.trim()).filter(Boolean),
    neverSay: strategy.neverSay,
  });
  const neverSay = [...new Set([...strategy.neverSay, ...(brief.neverSay ?? [])])];

  const composeInputs: ComposeVoiceInputs = {
    brief,
    cachedContext: buildCachedContext({
      contextText: contextText || "(no distilled context — speak only from the brief)",
      toneHints: strategy.toneHints,
      strategyNotes: strategy.strategyNotes,
    }),
    neverSay,
    lead: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      title: contact.title,
    },
    businessName,
    spokenName: resolved.spokenName,
  };

  const disclosure = renderVoiceDisclosure({
    language: strategy.language,
    spokenName: resolved.spokenName,
    businessName,
    recordingEnabled: voiceDefaults.recordingEnabled ?? false,
  });

  return {
    callId: call.id,
    workspaceId,
    campaignId: call.campaignId,
    agentId: call.agentId,
    contactId: call.contactId,
    enrollmentId: call.enrollmentId,
    providerCallSid: call.providerCallSid ?? "",
    systemPrompt: buildVoiceSystemPrompt(composeInputs),
    disclosure,
    disclosureVariant: resolved.spokenName ? "named" : "default",
    spokenNameSource: resolved.source,
    neverSay,
    ttsModel: persona.ttsModel,
    language: strategy.language,
    mustSay: brief.mustSay ?? [],
  };
}

export function createVoiceGateway(metrics: MetricsCollector): AiGateway {
  return new AiGateway({
    provider: new AnthropicProvider(),
    onUsage: (r) => {
      metrics.llmCostUsd += r.estimatedCostUsd;
      console.log(
        `[ai] task=${r.task} model=${r.model} in=${r.usage.inputTokens} out=${r.usage.outputTokens} latencyMs=${r.latencyMs} outcome=${r.outcome}`,
      );
    },
  });
}

/**
 * Finalize one call: idempotent transcript write, Call row update, events,
 * cost accounting + the cost alert. Safe to run once per stream end.
 */
export async function finalizeCall(args: {
  prisma: PrismaClient;
  publisher: VoiceEventsPublisher;
  context: CallContext;
  turns: VoiceTurn[];
  metrics: MetricsCollector;
  startedAt: Date;
  endReason: CallEndReason;
  costAlertUsd: number;
}): Promise<void> {
  const { prisma, publisher, context, turns, metrics, startedAt, endReason } = args;
  const report = metrics.report();
  const cost = report.cost;
  const durationSec = Math.round(report.callSeconds);
  const outcome = endReason === "provider_failure" ? "failed" : "completed";
  const coverage = mustSayCoverage(
    turns.filter((t) => t.role === "assistant").map((t) => t.content),
    { mustSay: context.mustSay },
  );

  const written = await persistTranscript(prisma, turns, {
    workspaceId: context.workspaceId,
    campaignId: context.campaignId,
    contactId: context.contactId,
    enrollmentId: context.enrollmentId,
    callId: context.callId,
    providerCallSid: context.providerCallSid || context.callId,
    startedAt,
  });

  await withTenant(prisma, { workspaceId: context.workspaceId }, (tx) =>
    tx.call.update({
      where: { id: context.callId },
      data: {
        status: outcome === "failed" ? "FAILED" : "COMPLETED",
        outcome,
        endedAt: new Date(startedAt.getTime() + durationSec * 1000),
        durationSec,
        costUsd: cost.totalUsd,
        meta: {
          endReason,
          disclosureVariant: context.disclosureVariant,
          disclosureCompleted: report.disclosureCompleted,
          spokenNameSource: context.spokenNameSource,
          ttfaMs: report.ttfaMs,
          commitSources: report.commitSources,
          ackRate: report.ackRate,
          bargeIns: report.bargeIns.length,
          costBreakdown: cost,
          mustSay: coverage,
          turnsPersisted: written,
        },
      },
    }),
  );

  const base = {
    workspaceId: context.workspaceId,
    campaignId: context.campaignId,
    contactId: context.contactId,
    enrollmentId: context.enrollmentId ?? undefined,
  };
  if (outcome === "failed") {
    await publisher.publish({
      ...base,
      type: EVENT_TYPES.CALL_FAILED,
      payload: { callId: context.callId, reason: endReason },
    });
  } else {
    await publisher.publish({
      ...base,
      type: EVENT_TYPES.CALL_COMPLETED,
      payload: { callId: context.callId, durationSec, outcome },
    });
  }

  if (cost.totalUsd > args.costAlertUsd) {
    // The vendor-onboarding cost alert: loud structured log — the ops signal.
    console.error(
      `[voice] COST ALERT call=${context.callId} $${cost.totalUsd.toFixed(4)} > $${args.costAlertUsd} threshold`,
    );
  }
}
