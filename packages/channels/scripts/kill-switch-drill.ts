/**
 * D1 (DEC-175): the KILL-SWITCH DRILL.
 *
 * The beta puts ~100 paying accounts on one SendGrid IP pool. Both emergency
 * stops — per-tenant suspension and the per-agency/per-channel kill switch —
 * are enforced at the send boundary (DEC-079 / DEC-082) and both are covered
 * by unit tests. What was never established is the question an owner actually
 * asks at 2am: **how long after I flip it does traffic stop?**
 *
 * A test proves the branch. A drill proves the LATENCY, against a real
 * database, with a real send in flight. This script is that drill.
 *
 * For each stop it: sends successfully (proving traffic is flowing), flips the
 * switch, then sends again and measures flip→refusal. It then clears the
 * switch and proves traffic RESUMES — a stop nobody can undo is an outage, not
 * a safety rail, so reversibility is part of the drill and not a footnote.
 *
 * It runs on its OWN data (one throwaway agency, deleted in `finally`) and
 * uses the keyless sandbox transport: the drill is about the boundary, and
 * delivering real mail to prove a refusal would be absurd. Every number it
 * prints is measured in this run; nothing is asserted from memory.
 *
 *   pnpm --filter @clientforce/channels exec tsx scripts/kill-switch-drill.ts
 */
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { KeylessSandboxSender } from "../src/sendgrid";
import { sendStep, type SendDeps, type SendStepParams } from "../src/send";
import { SendBlockedError } from "../src/types";

const THRESHOLD_MS = Number(process.env.DRILL_THRESHOLD_MS ?? 5_000);
const ADDRESS = "1 Main Street, Austin TX 78701";

interface Measurement {
  stop: string;
  expected: string;
  flipToRefusalMs: number;
  detail: string;
  restoredMs: number;
}

const results: Measurement[] = [];
let failures = 0;

function ok(label: string, detail = ""): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label: string, detail = ""): void {
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Send once; return the typed refusal reason, or null when it went through. */
async function trySend(deps: SendDeps, params: SendStepParams): Promise<SendBlockedError | null> {
  try {
    await sendStep(deps, params);
    return null;
  } catch (err) {
    if (err instanceof SendBlockedError) return err;
    throw err;
  }
}

/**
 * One stop, end to end: prove traffic flows, flip, measure the refusal, clear,
 * prove traffic flows again.
 */
async function drill(
  stop: string,
  expected: string,
  deps: SendDeps,
  params: SendStepParams,
  flip: () => Promise<void>,
  clear: () => Promise<void>,
): Promise<void> {
  console.log(`\n── ${stop} ──`);

  const baseline = await trySend(deps, params);
  if (baseline) {
    bad("baseline send", `expected delivery, got ${baseline.reason}`);
    return;
  }
  ok("baseline send", "traffic is flowing");

  const flippedAt = Date.now();
  await flip();
  const refusal = await trySend(deps, params);
  const flipToRefusalMs = Date.now() - flippedAt;

  if (!refusal) {
    bad("STOP DID NOT STOP", "a send went through after the switch was flipped");
  } else if (refusal.reason !== expected) {
    bad("wrong refusal", `expected ${expected}, got ${refusal.reason}`);
  } else if (flipToRefusalMs > THRESHOLD_MS) {
    bad("too slow", `${flipToRefusalMs}ms > ${THRESHOLD_MS}ms threshold`);
  } else {
    ok(`stopped in ${flipToRefusalMs}ms`, `${refusal.reason}: ${refusal.message}`);
  }

  const clearedAt = Date.now();
  await clear();
  const after = await trySend(deps, params);
  const restoredMs = Date.now() - clearedAt;
  if (after) bad("NOT REVERSIBLE", `still refusing with ${after.reason}`);
  else ok(`restored in ${restoredMs}ms`, "traffic resumed after clearing");

  results.push({
    stop,
    expected,
    flipToRefusalMs,
    detail: refusal?.message ?? "(no refusal)",
    restoredMs,
  });
}

async function main(): Promise<void> {
  const owner: PrismaClient = createPrismaClient();
  const app: PrismaClient = createAppPrismaClient();
  const suffix = `kill-drill-${Date.now()}`;

  console.log("\n=== D1 KILL-SWITCH DRILL (DEC-175) ===");
  console.log(`threshold: ${THRESHOLD_MS}ms · started ${new Date().toISOString()}`);

  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  try {
    const ws = await owner.workspace.create({
      data: { agencyId: agency.id, name: "drill", slug: suffix, settings: {} },
    });
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Drill Agent",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: {
            days: [1, 2, 3, 4, 5, 6, 7],
            start: "00:00",
            end: "23:59",
            timezone: "UTC",
          },
          dailyCap: { email: 10_000, sms: 100 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "drill", graphId: "g1" },
    });
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws.id,
        source: "drill",
        optOut: {},
        tags: [],
        email: `drill-${suffix}@t.test`,
        firstName: "Ada",
      },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws.id,
        type: "CF_MANAGED",
        fromEmail: `drill-${suffix}@send.clientforce.io`,
        fromName: "Drill",
        dailyLimit: 10_000,
      },
    });
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });

    const deps: SendDeps = {
      prisma: app,
      transport: new KeylessSandboxSender(),
      allowlist: [],
    };
    const params: SendStepParams = {
      workspaceId: ws.id,
      campaignId: campaign.id,
      agentId: agent.id,
      contactId: contact.id,
      senderId: sender.id,
      stepNodeId: "drill-step",
      content: { subject: "Drill", body: "Hi {{firstName}}" },
    };

    // 1 · the per-agency/per-channel kill switch (DEC-082).
    await drill(
      "KILL SWITCH · agency + email channel",
      "CHANNEL_KILLED",
      deps,
      params,
      async () => {
        await owner.killSwitch.create({
          data: { agencyId: agency.id, channel: "email", active: true, reason: "drill" },
        });
      },
      async () => {
        await owner.killSwitch.deleteMany({ where: { agencyId: agency.id, channel: "email" } });
      },
    );

    // 2 · workspace suspension (DEC-079).
    await drill(
      "SUSPENSION · workspace",
      "TENANT_SUSPENDED",
      deps,
      params,
      async () => {
        await owner.workspace.update({ where: { id: ws.id }, data: { status: "SUSPENDED" } });
      },
      async () => {
        await owner.workspace.update({ where: { id: ws.id }, data: { status: "ACTIVE" } });
      },
    );

    // 3 · agency suspension — the whole-tenant stop, which must cascade to
    //     every workspace under it without touching them individually.
    await drill(
      "SUSPENSION · agency (cascades to its workspaces)",
      "TENANT_SUSPENDED",
      deps,
      params,
      async () => {
        await owner.agency.update({ where: { id: agency.id }, data: { status: "SUSPENDED" } });
      },
      async () => {
        await owner.agency.update({ where: { id: agency.id }, data: { status: "ACTIVE" } });
      },
    );

    console.log("\n=== RESULT ===");
    console.log("stop                                              refusal            flip→stop   restore");
    for (const r of results) {
      console.log(
        `${r.stop.padEnd(50)}${r.expected.padEnd(19)}${`${r.flipToRefusalMs}ms`.padEnd(12)}${r.restoredMs}ms`,
      );
    }
    const slowest = results.reduce((m, r) => Math.max(m, r.flipToRefusalMs), 0);
    console.log(`\nslowest stop: ${slowest}ms (threshold ${THRESHOLD_MS}ms)`);

    if (failures > 0) {
      console.error(`\nDRILL FAILED — ${failures} check(s) did not pass.`);
      process.exitCode = 1;
      return;
    }
    console.log("DRILL PASSED — every stop refused typed, within threshold, and reversed.");
  } finally {
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
