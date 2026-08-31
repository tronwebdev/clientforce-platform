/**
 * B6.5 — a TRANSIENT first-party signal for the fidelity capture.
 *
 * The Lead finder's market feed only carries things that actually happened
 * (B6.5 review fix 1), so a workspace with no signal rows shows the honest
 * "nothing has fired yet" state — truthful, but it cannot demonstrate the
 * receipts or the recency grouping the frames exist to show. The seeded demo
 * has campaigns, facts, credits and a real brief, but zero `IntentSignal`
 * rows, because that table is only ever written by the live event bus.
 *
 * So this drives the REAL bus consumer with one synthetic event rather than
 * inserting a row behind it: the write goes through `createIntentConsumer`,
 * which means the shipped write-time suppression, shape eligibility, tier
 * gate and registry receipt all apply exactly as in production. If the
 * consumer would refuse the contact, no signal appears — which is the point.
 *
 *   tsx scripts/capture-signal.ts on   # emit, print what landed
 *   tsx scripts/capture-signal.ts off  # remove every row it created
 *
 * Honesty rails: it only ever touches the DEMO workspace, every row it writes
 * is tagged so `off` can find them, and the capture calls `off` in its own
 * teardown so a crashed run leaves nothing behind. It is capture fixture, not
 * seed data — the seed script is untouched.
 */
import { PrismaClient } from "@prisma/client";
import { createIntentConsumer } from "../src/index";
import type { BusEvent } from "@clientforce/events";

const MARKER = "b65-capture-signal";

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "";
  if (mode !== "on" && mode !== "off") throw new Error('usage: capture-signal.ts on|off');
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findFirst({ where: { slug: "demo" }, select: { id: true, settings: true } });
    if (!ws) {
      console.log("no demo workspace — nothing to do");
      return;
    }

    if (mode === "off") {
      const { count } = await prisma.intentSignal.deleteMany({
        where: { workspaceId: ws.id, meta: { path: ["marker"], equals: MARKER } },
      });
      console.log(`removed ${count} capture signal(s)`);
      return;
    }

    // Pick a DORMANT contact — one with no message history — that no
    // suppression rule removes. This is the sharpest demonstration of the
    // rule the review established: a record with nothing behind it stays out
    // of the market feed entirely, and appears only once a real event fires.
    // It also leaves the existing rows' stories untouched.
    const suppressed = new Set([
      ...(
        await prisma.enrollment.findMany({
          where: { workspaceId: ws.id, OR: [{ status: "ACTIVE" }, { pipelineStage: { in: ["booked", "won"] } }] },
          select: { contactId: true },
        })
      ).map((e) => e.contactId),
      ...(
        await prisma.contact.findMany({
          where: {
            workspaceId: ws.id,
            OR: [
              { optOut: { path: ["email"], equals: true } },
              { optOut: { path: ["sms"], equals: true } },
            ],
          },
          select: { id: true },
        })
      ).map((c) => c.id),
    ]);
    const withHistory = new Set(
      (
        await prisma.message.findMany({
          where: { workspaceId: ws.id },
          select: { contactId: true },
          distinct: ["contactId"],
        })
      ).map((m) => m.contactId),
    );
    const contacts = await prisma.contact.findMany({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const target = contacts.map((c) => c.id).find((id) => !suppressed.has(id) && !withHistory.has(id));
    if (!target) {
      console.log("no dormant, unsuppressed contact in the demo workspace — no signal emitted");
      return;
    }

    const profile = ((ws.settings ?? {}) as { icpProfile?: { shape?: string; vertical?: string } }).icpProfile;
    const consumer = createIntentConsumer({
      prisma,
      profileFor: async () => ({
        shape: (profile?.shape ?? "local_business") as "company" | "local_business" | "consumer",
        vertical: profile?.vertical ?? null,
      }),
    });

    // An inbound reply asking what it costs — one of the shipped mappings.
    const event: BusEvent = {
      id: `${MARKER}-1`,
      workspaceId: ws.id,
      type: "email.replied.v1" as BusEvent["type"],
      contactId: target,
      enrollmentId: null,
      campaignId: null,
      senderId: null,
      payload: { intent: "info_request", topic: "implants" },
      occurredAt: new Date().toISOString(),
    };
    await consumer.handle(event);

    // Tag whatever landed so `off` can find it. The consumer owns the write;
    // this only marks it, and marks nothing if the consumer refused.
    const { count } = await prisma.intentSignal.updateMany({
      where: { workspaceId: ws.id, meta: { path: ["eventId"], equals: event.id } },
      data: { meta: { eventId: event.id, eventType: event.type, marker: MARKER } },
    });
    const row = await prisma.intentSignal.findFirst({
      where: { workspaceId: ws.id, meta: { path: ["marker"], equals: MARKER } },
      select: { type: true, receipt: true, occurredAt: true },
    });
    console.log(
      count === 0
        ? "the consumer refused the contact — no signal written (that is the rail working)"
        : `emitted ${row?.type}: "${row?.receipt}"`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
