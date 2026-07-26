/**
 * The five scoped fetchers (SPEC A, DEC-099).
 *
 * Each one answers ONE kind of question against ONE store, bounded and
 * contact-scoped, through `withTenant` — never the owner client (CLAUDE.md).
 * None of them takes a "give me everything" path: the whole point of the unit
 * is that the brain asks a question and gets the slice that answers it.
 *
 * Two conventions hold across all five:
 * - Rows are fetched most-recent-first, so `rankByQuery`'s index tie-break is
 *   a recency tie-break.
 * - Every detail string goes through `toRecallDetail` (sanitize + cap). Stored
 *   history is full of URLs and markdown that TTS would mangle and the voice
 *   checks would refuse — stripping at this boundary keeps the refusal rail
 *   meaningful for real violations.
 */
import { RECALL_MAX_ITEMS, toRecallDetail, type RecallItem } from "@clientforce/core";
import { withTenant } from "@clientforce/db";
import { retrieve } from "@clientforce/knowledge";
import { rankByQuery } from "./rank";
import { spokenWhen } from "./when";
import type { FetchOutcome, RecallDeps, RecallTarget } from "./types";

/** Fetch window per facet — ranked down to RECALL_MAX_ITEMS afterwards. */
const SCAN_WINDOW = 25;

const CHANNEL_LABEL: Record<string, string> = {
  email: "email",
  sms: "text",
  voice: "call",
  whatsapp: "WhatsApp",
};

// ── history ─────────────────────────────────────────────────────────────────
/**
 * "Have we spoken before?" / "What did you say about X last time?"
 *
 * The CURRENT call's own turns are excluded. Without that, the agent would
 * retrieve the sentence it spoke ninety seconds ago and present it back as
 * prior history — technically true, conversationally deranged.
 */
export const fetchHistory = async (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
): Promise<FetchOutcome> => {
  const rows = await withTenant(deps.prisma, { workspaceId: target.workspaceId }, (tx) =>
    tx.message.findMany({
      where: { workspaceId: target.workspaceId, contactId: target.contactId },
      orderBy: { sentAt: "desc" },
      take: SCAN_WINDOW,
      select: {
        id: true,
        channel: true,
        direction: true,
        subject: true,
        body: true,
        intent: true,
        sentAt: true,
        meta: true,
      },
    }),
  );

  const now = new Date();
  const priorCall = rows.filter((r) => {
    const meta = r.meta as { callId?: unknown } | null;
    return meta?.callId !== target.callId;
  });

  const ranked = rankByQuery(
    priorCall,
    query,
    (r) => `${r.subject ?? ""} ${r.body}`,
    RECALL_MAX_ITEMS,
  );

  const items: RecallItem[] = ranked.map((r) => {
    const channel = CHANNEL_LABEL[r.channel] ?? r.channel;
    const who = r.direction === "INBOUND" ? "They said" : "We said";
    return {
      label: `${who} · ${channel}${r.intent ? ` · ${r.intent}` : ""}`,
      detail: toRecallDetail(r.subject ? `${r.subject} — ${r.body}` : r.body),
      at: spokenWhen(r.sentAt, now),
    };
  });

  return {
    items,
    sources: ranked.map((r) => r.id),
    note:
      priorCall.length > items.length
        ? `${priorCall.length} messages on file; the ${items.length} most relevant are here.`
        : undefined,
  };
};

// ── pipeline ────────────────────────────────────────────────────────────────
/** "Where am I in your system?" — campaign membership + stage + status. */
export const fetchPipeline = async (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
): Promise<FetchOutcome> => {
  const rows = await withTenant(deps.prisma, { workspaceId: target.workspaceId }, (tx) =>
    tx.enrollment.findMany({
      where: { workspaceId: target.workspaceId, contactId: target.contactId },
      orderBy: { updatedAt: "desc" },
      take: SCAN_WINDOW,
      select: {
        id: true,
        campaignId: true,
        pipelineStage: true,
        status: true,
        updatedAt: true,
        campaign: { select: { name: true } },
      },
    }),
  );

  const now = new Date();
  const ranked = rankByQuery(
    rows,
    query,
    (r) => `${r.campaign?.name ?? ""} ${r.pipelineStage} ${r.status}`,
    RECALL_MAX_ITEMS,
  );

  const items: RecallItem[] = ranked.map((r) => ({
    // The campaign this call belongs to is marked so the agent can tell "the
    // thing we're talking about now" from "something else they're also in".
    label: r.campaignId === target.campaignId ? "This campaign" : "Also enrolled in",
    detail: toRecallDetail(
      `${r.campaign?.name ?? "a campaign"} — stage "${r.pipelineStage}", ${r.status.toLowerCase()}`,
    ),
    at: spokenWhen(r.updatedAt, now),
  }));

  return { items, sources: ranked.map((r) => r.id) };
};

// ── bookings ────────────────────────────────────────────────────────────────
/**
 * "When was that call?" / a reschedule pulling the existing booking.
 *
 * Two honest sources, no third: completed `Call` rows, and stage moves INTO
 * the booked stage (`toStage === "booked"` — the same predicate the F1
 * outcomes rollup uses, so the two can never disagree about what "booked"
 * means). There is no calendar integration on main (Q-033), so there is no
 * meeting time to read out, and the note says so rather than letting the
 * model infer one from a stage move.
 */
export const fetchBookings = async (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
): Promise<FetchOutcome> => {
  const { calls, moves } = await withTenant(
    deps.prisma,
    { workspaceId: target.workspaceId },
    async (tx) => ({
      calls: await tx.call.findMany({
        where: {
          workspaceId: target.workspaceId,
          contactId: target.contactId,
          id: { not: target.callId },
        },
        orderBy: { createdAt: "desc" },
        take: SCAN_WINDOW,
        select: { id: true, outcome: true, status: true, durationSec: true, createdAt: true },
      }),
      moves: await tx.event.findMany({
        where: {
          workspaceId: target.workspaceId,
          contactId: target.contactId,
          type: "lead.stage_changed.v1",
        },
        orderBy: { occurredAt: "desc" },
        take: SCAN_WINDOW,
        select: { id: true, payload: true, occurredAt: true },
      }),
    }),
  );

  const now = new Date();
  const booked = moves.filter((m) => {
    const payload = m.payload as { toStage?: unknown } | null;
    return payload?.toStage === "booked";
  });

  const callItems = calls.map((c) => ({
    id: c.id,
    at: c.createdAt,
    label: "Previous call",
    text: c.outcome
      ? `${c.outcome.replace(/_/g, " ")}${c.durationSec ? `, ${Math.round(c.durationSec / 60)} minutes` : ""}`
      : `${c.status.toLowerCase().replace(/_/g, " ")} — no recorded outcome`,
  }));
  const bookedItems = booked.map((m) => ({
    id: m.id,
    at: m.occurredAt,
    label: "Marked booked",
    text: "this contact was moved to the booked stage",
  }));

  const merged = [...callItems, ...bookedItems].sort((a, b) => b.at.getTime() - a.at.getTime());
  const ranked = rankByQuery(merged, query, (r) => `${r.label} ${r.text}`, RECALL_MAX_ITEMS);

  return {
    items: ranked.map((r) => ({
      label: r.label,
      detail: toRecallDetail(r.text),
      at: spokenWhen(r.at, now),
    })),
    sources: ranked.map((r) => r.id),
    note:
      ranked.length > 0
        ? "No calendar is connected, so there is no meeting time on file — only that these happened."
        : undefined,
  };
};

// ── profile ─────────────────────────────────────────────────────────────────
/** The saved record itself: company/role, tags, lists, custom-field values. */
export const fetchProfile = async (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
): Promise<FetchOutcome> => {
  const { contact, defs, lists } = await withTenant(
    deps.prisma,
    { workspaceId: target.workspaceId },
    async (tx) => ({
      contact: await tx.contact.findUnique({
        where: { id: target.contactId },
        select: { id: true, company: true, title: true, tags: true, custom: true, createdAt: true },
      }),
      defs: await tx.contactFieldDef.findMany({
        where: { workspaceId: target.workspaceId },
        select: { key: true, label: true },
      }),
      lists: await tx.contactListMember.findMany({
        where: { workspaceId: target.workspaceId, contactId: target.contactId },
        take: SCAN_WINDOW,
        select: { listId: true, list: { select: { name: true, archived: true } } },
      }),
    }),
  );
  if (!contact) return { items: [], sources: [] };

  const now = new Date();
  const labelFor = new Map(defs.map((d) => [d.key, d.label]));
  const candidates: Array<{ id: string; label: string; text: string; at?: Date }> = [];

  if (contact.company || contact.title) {
    candidates.push({
      id: `${contact.id}:role`,
      label: "Role",
      text: [contact.title, contact.company].filter(Boolean).join(" at "),
    });
  }
  if (contact.tags.length > 0) {
    candidates.push({
      id: `${contact.id}:tags`,
      label: "Tags",
      text: contact.tags.join(", "),
    });
  }
  for (const l of lists.filter((l) => !l.list?.archived)) {
    candidates.push({
      id: l.listId,
      label: "On list",
      text: l.list?.name ?? "a list",
    });
  }
  const custom = (contact.custom ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(custom)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    candidates.push({
      id: `${contact.id}:custom:${key}`,
      // The owner-facing LABEL, not the storage key — the agent speaks this.
      label: labelFor.get(key) ?? key,
      text: String(value),
    });
  }
  candidates.push({
    id: `${contact.id}:added`,
    label: "On file since",
    text: "this contact was added to the workspace",
    at: contact.createdAt,
  });

  const ranked = rankByQuery(candidates, query, (c) => `${c.label} ${c.text}`, RECALL_MAX_ITEMS);
  return {
    items: ranked.map((c) => ({
      label: c.label,
      detail: toRecallDetail(c.text),
      ...(c.at ? { at: spokenWhen(c.at, now) } : {}),
    })),
    sources: ranked.map((c) => c.id),
  };
};

// ── knowledge ───────────────────────────────────────────────────────────────
/**
 * "What does it cost?" → the offer/pricing chunk. The ONLY facet that is not
 * about this contact: it searches the workspace's own ingested knowledge
 * through the P1.2 RAG retriever, agent-scoped exactly as the composers scope
 * it, so a call can never surface another agent's private sources.
 */
export const fetchKnowledge = async (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
): Promise<FetchOutcome> => {
  if (!deps.gateway) {
    // Structural, not a runtime surprise: without a gateway there is no
    // embedding, so there is no search. Reported as an honest empty.
    return { items: [], sources: [], note: "Knowledge search is not available on this call." };
  }
  const chunks = await retrieve(deps.prisma, deps.gateway, target.workspaceId, query, {
    scope: { agentId: target.agentId, includeWorkspace: true },
    k: RECALL_MAX_ITEMS,
  });

  return {
    items: chunks.map((c) => ({
      label: `From ${c.sourceLabel}`,
      detail: toRecallDetail(c.content),
    })),
    sources: chunks.map((c) => c.id),
  };
};
