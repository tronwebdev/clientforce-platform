/**
 * B4.5 (DEC-128) — the TRANSIENT live-call fixture for the browser e2e and
 * the fidelity capture. There is no local voice loop (Deepgram/Twilio), so a
 * genuinely IN_PROGRESS Ada call cannot arise on a dev box; this script
 * writes one — through the same row shapes the voice service writes — so the
 * card renders REAL DB truth, then tears it down.
 *
 *   tsx prisma/b45-live-fixture.ts ring     → QUEUED, no turns (dial ringing)
 *   tsx prisma/b45-live-fixture.ts live     → prints the callId (creates/rearms)
 *   tsx prisma/b45-live-fixture.ts handled  → COMPLETED (the card's done state)
 *   tsx prisma/b45-live-fixture.ts done     → deletes the fixture rows
 *
 * Honesty rails: the contact is e2e-tagged (the Q-086 interim cleanup sweeps
 * e2e-* on every seed), the sid is fixed and sandbox-prefixed, and `done`
 * removes every row — nothing lingers pretending to be a call that happened.
 */
import { PrismaClient } from "@prisma/client";

const SID = "CA-sandbox-b45-live";
const EMAIL = "e2e-b45-live@fixture.test";

const TURNS: ReadonlyArray<readonly ["OUTBOUND" | "INBOUND", string]> = [
  ["OUTBOUND", "Hi, this is Ada — the AI assistant for Bright Smile. Is now still a good moment to talk about your visit?"],
  ["INBOUND", "Oh — yes, actually. I wanted to ask about the times you sent over."],
  ["OUTBOUND", "Great. I have Thursday at 3:00 or Friday at 9:40 — either of those work?"],
  ["INBOUND", "Thursday should work I think."],
];

async function main(): Promise<void> {
  const phase = process.argv[2];
  if (!["ring", "live", "handled", "done"].includes(phase ?? "")) {
    throw new Error("usage: b45-live-fixture.ts ring|live|handled|done");
  }
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findFirstOrThrow({ where: { slug: "demo" } });
    if (phase === "done") {
      const call = await prisma.call.findUnique({ where: { providerCallSid: SID } });
      if (call) {
        await prisma.message.deleteMany({ where: { providerMessageId: { startsWith: `voice:${SID}:` } } });
        await prisma.event.deleteMany({
          where: { workspaceId: ws.id, type: "call.taken_over.v1", payload: { path: ["callId"], equals: call.id } },
        });
        await prisma.call.delete({ where: { id: call.id } });
      }
      await prisma.contact.deleteMany({ where: { workspaceId: ws.id, email: EMAIL } });
      console.log("fixture removed");
      return;
    }

    const campaign = await prisma.campaign.findFirstOrThrow({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: "asc" },
    });
    const contact =
      (await prisma.contact.findFirst({ where: { workspaceId: ws.id, email: EMAIL } })) ??
      (await prisma.contact.create({
        data: {
          workspaceId: ws.id,
          source: "e2e",
          optOut: {},
          tags: ["e2e-b45"],
          email: EMAIL,
          phone: "+15125550190",
          firstName: "Livia",
          lastName: "Hart",
          callConsent: "granted",
        },
      }));

    // Re-arm idempotently into the requested phase.
    const startedAt = new Date(Date.now() - 45_000);
    const phaseData =
      phase === "ring"
        ? // createdAt bumps so the live feed's 2-minute ringing window sees a re-armed row.
          { status: "QUEUED" as const, outcome: null, endedAt: null, durationSec: null, startedAt: null, createdAt: new Date() }
        : phase === "handled"
          ? {
              status: "COMPLETED" as const,
              outcome: "completed",
              endedAt: new Date(),
              durationSec: 118,
              startedAt,
            }
          : { status: "IN_PROGRESS" as const, outcome: null, endedAt: null, durationSec: null, startedAt };
    const existing = await prisma.call.findUnique({ where: { providerCallSid: SID } });
    const call = existing
      ? await prisma.call.update({
          where: { id: existing.id },
          data: { ...phaseData, meta: { sandbox: true, fixture: "b45" } },
        })
      : await prisma.call.create({
          data: {
            workspaceId: ws.id,
            campaignId: campaign.id,
            agentId: campaign.agentId,
            contactId: contact.id,
            caller: "ada",
            direction: "OUTBOUND",
            providerCallSid: SID,
            ...phaseData,
            meta: { sandbox: true, fixture: "b45" },
          },
        });
    if (phase === "ring") {
      // A ringing dial has said nothing yet.
      await prisma.message.deleteMany({ where: { providerMessageId: { startsWith: `voice:${SID}:` } } });
      console.log(call.id);
      return;
    }
    // The per-turn rows, exactly as persistLatestTurn shapes them.
    for (let i = 0; i < TURNS.length; i++) {
      const [direction, body] = TURNS[i]!;
      await prisma.message.upsert({
        where: { providerMessageId: `voice:${SID}:${i}` },
        update: { body },
        create: {
          workspaceId: ws.id,
          campaignId: campaign.id,
          contactId: contact.id,
          channel: "voice",
          direction,
          body,
          providerMessageId: `voice:${SID}:${i}`,
          intent: null,
          sentAt: new Date(startedAt.getTime() + i * 9_000),
          meta: { callId: call.id, turnIndex: i },
        },
      });
    }
    console.log(call.id);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
