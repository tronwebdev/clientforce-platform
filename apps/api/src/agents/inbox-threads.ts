import type { Prisma } from "@clientforce/db";

/**
 * B3a (DEC-112): the ONE inbox thread assembler — extracted verbatim from the
 * B2 campaign read (`GET /agents/:id/inbox`) so the workspace-wide read
 * (`GET /inbox`) can never drift from it. Threads are keyed per
 * (campaign, contact): the same contact replying inside two campaigns is two
 * threads, which is what "campaign attribution per thread" (§4.5 workspace
 * scope) means. Every rule the campaign inbox pinned rides along unchanged:
 * contacts with no inbound never appear, unsubscribe threads live in Contacts
 * (DEC-034), unread = inbound newer than last outbound, done = meta.done on
 * the latest inbound, calendar/payment Event rows interleave (DEC-094/095,
 * Event-sourced — never a fabricated Message), and guided-compose provenance
 * surfaces only where the send boundary stamped it (DEC-075).
 */

export interface InboxCampaignRef {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
}

export async function assembleInboxThreads(tx: Prisma.TransactionClient, campaigns: InboxCampaignRef[]) {
  if (campaigns.length === 0) return [];
  const campaignIds = campaigns.map((c) => c.id);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const messages = await tx.message.findMany({
    where: { campaignId: { in: campaignIds } },
    orderBy: { sentAt: "asc" },
  });
  const contactIds = [...new Set(messages.map((m) => m.contactId))];
  const contacts = await tx.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, firstName: true, lastName: true, company: true, email: true },
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const enrollments = await tx.enrollment.findMany({
    where: { campaignId: { in: campaignIds }, contactId: { in: contactIds } },
    select: { id: true, contactId: true, campaignId: true, pipelineStage: true },
  });
  const enrollmentByKey = new Map(enrollments.map((e) => [`${e.campaignId}:${e.contactId}`, e]));

  // B3b (DEC-117): per-thread working state + the reply-hold indicator.
  const [threadStates, activeHolds] = await Promise.all([
    tx.threadState.findMany({
      where: { campaignId: { in: campaignIds }, contactId: { in: contactIds } },
    }),
    tx.enrollmentReplyHold.findMany({
      where: { enrollmentId: { in: enrollments.map((e) => e.id) }, releasedAt: null },
      select: { enrollmentId: true },
    }),
  ]);
  const stateByKey = new Map(threadStates.map((t) => [`${t.campaignId}:${t.contactId}`, t]));
  const heldEnrollments = new Set(activeHolds.map((h) => h.enrollmentId));
  const assigneeIds = [...new Set(threadStates.map((t) => t.assigneeUserId).filter((v): v is string => Boolean(v)))];
  const assignees =
    assigneeIds.length > 0
      ? await tx.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, email: true, name: true } })
      : [];
  const assigneeById = new Map(assignees.map((u) => [u.id, u]));

  // DEC-094/DEC-095: contact-anchored calendar + payment system rows.
  const calendarEvents =
    contactIds.length > 0
      ? await tx.event.findMany({
          where: {
            contactId: { in: contactIds },
            OR: [
              { type: { startsWith: "calendar." } },
              { type: "payment.received.v1" },
              // B3c-1 (DEC-119): call outcomes interleave as system rows —
              // Event-sourced like calendar/payment (never a fabricated
              // Message); the renderers decide which types show.
              { type: { startsWith: "call." } },
            ],
          },
          orderBy: { occurredAt: "asc" },
        })
      : [];

  const keys = [...new Set(messages.map((m) => `${m.campaignId}:${m.contactId}`))];
  return keys
    .map((key) => {
      const [campaignId] = key.split(":") as [string, string];
      const msgs = messages.filter((m) => `${m.campaignId}:${m.contactId}` === key);
      const contactId = msgs[0]!.contactId;
      const lastInbound = [...msgs].reverse().find((m) => m.direction === "INBOUND");
      if (!lastInbound) return null; // Inbox shows conversations with replies
      if (lastInbound.intent === "unsubscribe") return null; // DEC-034
      const lastOutbound = [...msgs].reverse().find((m) => m.direction === "OUTBOUND");
      const last = msgs[msgs.length - 1]!;
      const meta = (lastInbound.meta ?? {}) as { done?: boolean };
      const enrollment = enrollmentByKey.get(key);
      const campaign = campaignById.get(campaignId)!;
      return {
        contactId,
        contact: contactById.get(contactId) ?? null,
        // B3a: the attribution the workspace scope renders; campaign scope
        // carries it too (additive — one shape, never two).
        campaign: { id: campaign.id, name: campaign.name, agentId: campaign.agentId, agentName: campaign.agentName },
        enrollmentId: enrollment?.id ?? null,
        stage: enrollment?.pipelineStage ?? null,
        // B3b: held = Ada is paused on this thread's enrollment (reply-hold).
        adaHeld: enrollment ? heldEnrollments.has(enrollment.id) : false,
        assignee: (() => {
          const st = stateByKey.get(key);
          return st?.assigneeUserId ? (assigneeById.get(st.assigneeUserId) ?? null) : null;
        })(),
        snoozedUntil: (() => {
          const st = stateByKey.get(key);
          return st?.snoozedUntil ? st.snoozedUntil.toISOString() : null;
        })(),
        channels: [...new Set(msgs.map((m) => m.channel))],
        intent: lastInbound.intent ?? null,
        unread: !lastOutbound || lastInbound.sentAt > lastOutbound.sentAt,
        done: meta.done === true,
        lastAt: last.sentAt.toISOString(),
        preview: (last.body ?? "").slice(0, 140),
        messageCount: msgs.length,
        events: calendarEvents
          .filter((e) => e.contactId === contactId)
          .map((e) => ({
            id: e.id,
            type: e.type,
            payload: e.payload,
            occurredAt: e.occurredAt.toISOString(),
          })),
        messages: msgs.map((m) => {
          const mm = (m.meta ?? {}) as {
            mode?: string;
            composerVersion?: string;
            reply?: { userId: string; draft: "ada" | "none"; draftEdited?: boolean };
          };
          return {
            id: m.id,
            direction: m.direction,
            channel: m.channel,
            subject: m.subject,
            body: m.body,
            intent: m.intent,
            sentAt: m.sentAt.toISOString(),
            ...(m.direction === "OUTBOUND" && mm.mode === "guided"
              ? { composed: { composerVersion: mm.composerVersion ?? null } }
              : {}),
            // B3b: human-reply provenance (the boundary stamped it).
            ...(m.direction === "OUTBOUND" && mm.reply ? { reply: mm.reply } : {}),
          };
        }),
      };
    })
    .filter(Boolean);
}
