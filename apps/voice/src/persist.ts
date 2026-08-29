/**
 * Transcript persistence (P3.1, DEC-078) — every caller turn one INBOUND
 * Message, every agent turn one OUTBOUND Message, all `channel:"voice"`, via
 * `withTenant` (RLS-subject client, per CLAUDE.md) — the spike-proven A6
 * mapping, now IDEMPOTENT: `providerMessageId` = `voice:{callSid}:{index}` is
 * unique, and `createMany({ skipDuplicates })` makes a retried finalize write
 * each row exactly once. Transcripts persist regardless of the recording
 * setting — the transcript is the always-on operational record.
 */
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";
import { COMPOSER_VOICE_VERSION } from "@clientforce/channels";
import type { VoiceTurn } from "./session";

export interface TranscriptTarget {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  enrollmentId: string | null;
  callId: string;
  providerCallSid: string;
  /** Wall-clock call start — turn atMs offsets are applied to it. */
  startedAt: Date;
}

export interface VoiceMessageRow {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  enrollmentId: string | null;
  channel: "voice";
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  providerMessageId: string;
  intent: null;
  sentAt: Date;
  meta: Prisma.InputJsonValue;
}

export function rowsFromTranscript(
  turns: VoiceTurn[],
  target: TranscriptTarget,
): VoiceMessageRow[] {
  const base = target.startedAt.getTime();
  return turns
    .filter((t) => t.content.trim().length > 0)
    .map((t, index) => ({
      workspaceId: target.workspaceId,
      campaignId: target.campaignId,
      contactId: target.contactId,
      enrollmentId: target.enrollmentId,
      channel: "voice" as const,
      direction: t.role === "user" ? ("INBOUND" as const) : ("OUTBOUND" as const),
      body: t.content,
      // Deterministic per (call, position) — the idempotency key.
      providerMessageId: `voice:${target.providerCallSid}:${index}`,
      intent: null,
      sentAt: new Date(base + (t.atMs ?? index * 1000)),
      meta: {
        callId: target.callId,
        turnIndex: index,
        ...(t.role === "assistant" ? { composerVersion: COMPOSER_VOICE_VERSION } : {}),
        ...(t.commitSource ? { commitSource: t.commitSource } : {}),
        ...(t.refusalReason ? { refusalReason: t.refusalReason } : {}),
      },
    }));
}

/** Idempotent write — safe to run again on a retried finalize. Returns the
 *  number of transcript rows now in place (B4.5: the live per-turn feed may
 *  have written most of them already; finalize converges bodies a barge-in
 *  amended after their live write). */
export async function persistTranscript(
  prisma: PrismaClient,
  turns: VoiceTurn[],
  target: TranscriptTarget,
): Promise<number> {
  const rows = rowsFromTranscript(turns, target);
  if (rows.length === 0) return 0;
  const result = await withTenant(prisma, { workspaceId: target.workspaceId }, (tx) =>
    tx.message.createMany({ data: rows, skipDuplicates: true }),
  );
  if (result.count < rows.length) {
    await withTenant(prisma, { workspaceId: target.workspaceId }, async (tx) => {
      for (const row of rows) {
        await tx.message.updateMany({
          where: { providerMessageId: row.providerMessageId, NOT: { body: row.body } },
          data: { body: row.body },
        });
      }
    });
  }
  return rows.length;
}

/**
 * B4.5 (DEC-128): the LIVE per-turn write — the same rows, the same
 * idempotency key, written the moment a turn's text is fixed instead of at
 * finalize. Only the LAST row is touched: rows are recomputed from the full
 * transcript each time so the index scheme agrees with finalize by
 * construction, and a barge-in amendment happens while the amended turn is
 * still last. Finalize reconciles anything this missed.
 */
export async function persistLatestTurn(
  prisma: PrismaClient,
  turns: VoiceTurn[],
  target: TranscriptTarget,
): Promise<void> {
  const rows = rowsFromTranscript(turns, target);
  const last = rows[rows.length - 1];
  if (!last) return;
  await withTenant(prisma, { workspaceId: target.workspaceId }, (tx) =>
    tx.message.upsert({
      where: { providerMessageId: last.providerMessageId },
      update: { body: last.body },
      create: last,
    }),
  );
}
