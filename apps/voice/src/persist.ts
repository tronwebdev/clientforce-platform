/**
 * Persistence taste-test (P3.0): map a call transcript onto `Message` rows with
 * channel "voice" — proving the Phase-1 data model absorbs voice with NO
 * migration. Every outbound turn is one OUTBOUND Message; every caller turn is
 * one INBOUND Message, exactly as email/SMS already persist (DATA_MODEL A6).
 *
 * Writes go through the RLS-subject client (`withTenant`) per CLAUDE.md — never
 * the owner client. Point it at a seeded demo workspace:
 *   WORKSPACE_ID, CAMPAIGN_ID, CONTACT_ID  (required to actually write)
 *   ENROLLMENT_ID                          (optional; Message.enrollmentId is nullable)
 *   METRICS_IN                             (default ./metrics.json)
 * With no IDs set it runs a DRY RUN and prints the rows it would insert, so the
 * CI workflow can exercise the mapping without a database.
 */
import { readFileSync } from "node:fs";
import { createAppPrismaClient, withTenant, Prisma } from "@clientforce/db";

interface TranscriptTurn {
  turn: number;
  user: string;
  assistant: string;
  bargedIn: boolean;
}

interface MessageRow {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  enrollmentId: string | null;
  channel: "voice";
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  intent: string | null;
  sentAt: Date;
  meta: Prisma.InputJsonValue;
}

function rowsFromTranscript(
  transcript: TranscriptTurn[],
  ctx: { workspaceId: string; campaignId: string; contactId: string; enrollmentId: string | null },
): MessageRow[] {
  const base = Date.now();
  const rows: MessageRow[] = [];
  for (const t of transcript) {
    if (t.user) {
      rows.push({
        ...ctx,
        channel: "voice",
        direction: "INBOUND",
        body: t.user,
        intent: null,
        sentAt: new Date(base + t.turn * 2000),
        meta: { turn: t.turn, source: "voice-spike" },
      });
    }
    if (t.assistant) {
      rows.push({
        ...ctx,
        channel: "voice",
        direction: "OUTBOUND",
        body: t.assistant,
        intent: null,
        sentAt: new Date(base + t.turn * 2000 + 1000),
        meta: { turn: t.turn, source: "voice-spike", bargedIn: t.bargedIn },
      });
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const metricsIn = process.env.METRICS_IN ?? "./metrics.json";
  const report = JSON.parse(readFileSync(metricsIn, "utf8")) as { transcript?: TranscriptTurn[] };
  const transcript = report.transcript ?? [];
  const workspaceId = process.env.WORKSPACE_ID;
  const campaignId = process.env.CAMPAIGN_ID;
  const contactId = process.env.CONTACT_ID;
  const enrollmentId = process.env.ENROLLMENT_ID ?? null;

  if (!workspaceId || !campaignId || !contactId) {
    const rows = rowsFromTranscript(transcript, {
      workspaceId: "<workspace>",
      campaignId: "<campaign>",
      contactId: "<contact>",
      enrollmentId,
    });
    console.log(
      `[persist] DRY RUN — no WORKSPACE_ID/CAMPAIGN_ID/CONTACT_ID set. ` +
        `${rows.length} voice Message rows would be written:`,
    );
    for (const r of rows) console.log(`  ${r.direction.padEnd(8)} voice  "${r.body.slice(0, 60)}"`);
    return;
  }

  const rows = rowsFromTranscript(transcript, { workspaceId, campaignId, contactId, enrollmentId });
  const prisma = createAppPrismaClient();
  try {
    const created = await withTenant(prisma, { workspaceId }, async (tx) => {
      const result = await tx.message.createMany({ data: rows });
      return result.count;
    });
    console.log(`[persist] wrote ${created} voice Message rows to workspace ${workspaceId}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error("[persist] failed:", (err as Error).message);
  process.exitCode = 1;
});
