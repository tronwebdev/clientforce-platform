/**
 * The validation service (LH1, DEC-087) — async, never blocking a flow.
 *
 * FREE filters run before ANY paid call, order PINNED (tested, not just
 * documented): dedupe → verdict-cache hit → already-suppressed skip →
 * syntax → MX/domain DNS. Only survivors hit the provider, and only up to
 * the spend rails' headroom (per-workspace daily allowance, platform-wide
 * daily spend ceiling — throttles, never charges: beyond them batches HOLD
 * with the honest "validation queued" state and drain next UTC day).
 *
 * A provider outage is a TYPED refusal: items stay `pending`, contacts stay
 * `unverified` (and held at the enrollment gate) — nothing silently enrolls,
 * nothing invents a verdict.
 */
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import {
  VALIDATION_CHUNK_SIZE,
  VALIDATION_CLAIM_LEASE_MS,
  VALIDATION_COST_PER_CHECK_MICROS,
  VALIDATION_DAILY_ALLOWANCE,
  VALIDATION_VERDICT_TTL_DAYS,
  VALIDATION_WORKSPACE_CONCURRENCY,
  validationCeilingChecks,
} from "./constants";
import { checkMxDomains, domainOf, normalizeEmail, syntaxValid } from "./filters";
import {
  ValidationProviderError,
  type EmailValidationProvider,
  type ResolveMx,
  type ValidationEventPublish,
} from "./types";

export interface ValidationConfig {
  dailyAllowance: number;
  ceilingChecks: number;
  chunkSize: number;
  ttlDays: number;
  costPerCheckMicros: number;
  claimLeaseMs: number;
  workspaceConcurrency: number;
}

export interface ValidationDeps {
  /** RLS-subject app client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  /** Privileged client for the PLATFORM-wide spend count ONLY (worker context). */
  ownerPrisma: PrismaClient;
  provider: EmailValidationProvider;
  publish: ValidationEventPublish;
  /** `node:dns/promises`-style MX resolver — CI injects a mock. */
  resolveMx?: ResolveMx;
  now?: () => Date;
  config?: Partial<ValidationConfig>;
}

const configOf = (deps: ValidationDeps): ValidationConfig => ({
  dailyAllowance: deps.config?.dailyAllowance ?? VALIDATION_DAILY_ALLOWANCE,
  ceilingChecks: deps.config?.ceilingChecks ?? validationCeilingChecks(),
  chunkSize: deps.config?.chunkSize ?? VALIDATION_CHUNK_SIZE,
  ttlDays: deps.config?.ttlDays ?? VALIDATION_VERDICT_TTL_DAYS,
  costPerCheckMicros: deps.config?.costPerCheckMicros ?? VALIDATION_COST_PER_CHECK_MICROS,
  claimLeaseMs: deps.config?.claimLeaseMs ?? VALIDATION_CLAIM_LEASE_MS,
  workspaceConcurrency: deps.config?.workspaceConcurrency ?? VALIDATION_WORKSPACE_CONCURRENCY,
});

export const dayStartUtc = (now: Date): Date => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Ms until the next UTC day begins (allowance/ceiling holds requeue then). */
export const msToNextUtcDay = (now: Date): number => {
  const next = dayStartUtc(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
};

/** Paid verifications for one workspace since `start` (tenant-scoped). */
export async function billedSince(
  prisma: PrismaClient,
  workspaceId: string,
  start: Date,
): Promise<number> {
  return withTenant(prisma, { workspaceId }, (tx) =>
    tx.emailValidationVerdict.count({ where: { billedAt: { gte: start } } }),
  );
}

/** Paid verifications platform-wide since `start` (privileged client). */
export async function billedSincePlatform(ownerPrisma: PrismaClient, start: Date): Promise<number> {
  return ownerPrisma.emailValidationVerdict.count({ where: { billedAt: { gte: start } } });
}

export interface EnqueueContact {
  contactId: string;
  email: string;
}

/**
 * Create-or-attach a validation batch (idempotent on the client key: every
 * chunk of one CSV import lands on ONE batch). Items dedupe on
 * (batchId, contactId); every row starts `pending` and resolves through the
 * one pinned pipeline — no per-source forks.
 */
export async function upsertValidationBatch(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    source: "csv_import" | "manual" | "single";
    clientKey?: string;
    listId?: string;
    contacts: EnqueueContact[];
  },
): Promise<{ batchId: string; added: number }> {
  return withTenant(prisma, { workspaceId: input.workspaceId }, async (tx) => {
    const existing = input.clientKey
      ? await tx.validationBatch.findUnique({
          where: {
            workspaceId_clientKey: { workspaceId: input.workspaceId, clientKey: input.clientKey },
          },
        })
      : null;
    const batch =
      existing ??
      (await tx.validationBatch.create({
        data: {
          workspaceId: input.workspaceId,
          clientKey: input.clientKey ?? null,
          source: input.source,
          listId: input.listId ?? null,
        },
      }));
    // A new chunk arriving on a completed batch re-opens it (a late import
    // chunk after fast validation) — pending items exist again.
    if (existing && existing.status === "completed" && input.contacts.length > 0) {
      await tx.validationBatch.update({
        where: { id: batch.id },
        data: { status: "queued", completedAt: null },
      });
    }
    const res = await tx.validationBatchItem.createMany({
      data: input.contacts.map((c) => ({
        workspaceId: input.workspaceId,
        batchId: batch.id,
        contactId: c.contactId,
        address: normalizeEmail(c.email),
      })),
      skipDuplicates: true,
    });
    return { batchId: batch.id, added: res.count };
  });
}

export interface ChunkResult {
  batchId: string;
  workspaceId: string;
  status: "completed" | "running" | "held" | "skipped";
  heldReason?: "workspace_allowance" | "platform_spend_ceiling" | "provider_unavailable";
  /** Items resolved this turn. */
  resolved: number;
  /** More pending items — run another turn. */
  requeue: boolean;
  requeueDelayMs?: number;
  /** Contact verdicts landed — the caller drains enrollment holds. */
  verdictsLanded: boolean;
}

interface Resolution {
  verdict: "valid" | "risky" | "invalid";
  via: "cache" | "zerobounce" | "syntax" | "mx";
  subStatus?: string;
  billed: boolean;
}

/**
 * One queue turn: claim the batch, resolve up to `chunkSize` pending items
 * through the pinned pipeline, persist, finalize when drained. Concurrent
 * batches interleave turn-by-turn (queue fairness); the claim lease makes a
 * duplicate turn skip instead of double-billing.
 */
export async function processValidationBatchChunk(
  deps: ValidationDeps,
  workspaceId: string,
  batchId: string,
): Promise<ChunkResult> {
  const cfg = configOf(deps);
  const now = deps.now?.() ?? new Date();
  const base: Omit<ChunkResult, "status"> = {
    batchId,
    workspaceId,
    resolved: 0,
    requeue: false,
    verdictsLanded: false,
  };

  // ── Claim (lease) ──────────────────────────────────────────────────────────
  const claimed = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatch.updateMany({
      where: {
        id: batchId,
        status: { not: "completed" },
        OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }],
      },
      data: { claimedUntil: new Date(now.getTime() + cfg.claimLeaseMs) },
    }),
  );
  if (claimed.count === 0) {
    const row = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.validationBatch.findUnique({ where: { id: batchId }, select: { status: true } }),
    );
    // A batch that finished under another turn IS completed — say so.
    if (row && row.status === "completed") return { ...base, status: "completed" };
    return { ...base, status: "skipped", requeue: Boolean(row), requeueDelayMs: 30_000 };
  }

  const batch = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatch.findUniqueOrThrow({ where: { id: batchId } }),
  );

  // ── Workspace concurrency slice (fair-use: excess batches stay queued) ────
  if (batch.status === "queued") {
    const running = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.validationBatch.count({ where: { status: "running", id: { not: batchId } } }),
    );
    if (running >= cfg.workspaceConcurrency) {
      await setBatch(deps, workspaceId, batchId, { claimedUntil: null });
      return { ...base, status: "skipped", requeue: true, requeueDelayMs: 15_000 };
    }
  }

  const items = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatchItem.findMany({
      where: { batchId, outcome: "pending" },
      orderBy: { id: "asc" },
      take: cfg.chunkSize,
    }),
  );
  if (items.length === 0) {
    const completed = await finalizeIfDrained(deps, workspaceId, batchId, now);
    return { ...base, status: completed ? "completed" : "running" };
  }
  if (batch.status !== "running") {
    await setBatch(deps, workspaceId, batchId, { status: "running", heldReason: null });
  }

  // ── The pinned FREE-filter order ───────────────────────────────────────────
  // 1 · dedupe: one resolution per normalized address covers all its items.
  const addresses = [...new Set(items.map((i) => i.address))];
  const resolutions = new Map<string, Resolution>();
  const suppressedSkip = new Set<string>();

  // 2 · verdict-cache hit — a fresh row never re-bills.
  const cacheRows = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.emailValidationVerdict.findMany({ where: { address: { in: addresses } } }),
  );
  for (const row of cacheRows) {
    if (row.expiresAt > now) {
      resolutions.set(row.address, {
        verdict: row.verdict as Resolution["verdict"],
        via: "cache",
        ...(row.subStatus ? { subStatus: row.subStatus } : {}),
        billed: false,
      });
    }
  }

  // 3 · already-suppressed skip — never pay to validate a suppressed row
  // (the ledger stays authoritative; these rows can't be sent to anyway).
  const remainderAfterCache = addresses.filter((a) => !resolutions.has(a));
  if (remainderAfterCache.length > 0) {
    const suppressions = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.suppression.findMany({
        where: { channel: "email", address: { in: remainderAfterCache } },
        select: { address: true },
      }),
    );
    for (const s of suppressions) suppressedSkip.add(s.address);
  }

  // 4 · syntax — same acceptance rule as the import DTO.
  const afterSuppression = remainderAfterCache.filter((a) => !suppressedSkip.has(a));
  const syntaxFails = afterSuppression.filter((a) => !syntaxValid(a));
  for (const a of syntaxFails) {
    resolutions.set(a, { verdict: "invalid", via: "syntax", subStatus: "failed_syntax_check", billed: false });
  }

  // 5 · MX / domain DNS — fail-open on resolver trouble (only a definitive
  // no-mail-route answer mints an invalid).
  const mxCandidates = afterSuppression.filter((a) => syntaxValid(a));
  if (mxCandidates.length > 0 && deps.resolveMx) {
    const domains = new Set(mxCandidates.map((a) => domainOf(a)).filter((d): d is string => Boolean(d)));
    const mxStates = await checkMxDomains(domains, deps.resolveMx);
    for (const a of mxCandidates) {
      const d = domainOf(a);
      if (d && mxStates.get(d) === "none") {
        resolutions.set(a, { verdict: "invalid", via: "mx", subStatus: "no_mx_record", billed: false });
      }
    }
  }

  // ── Spend rails: only survivors hit the provider, only up to headroom ─────
  const payables = mxCandidates.filter((a) => !resolutions.has(a));
  let held: ChunkResult["heldReason"];
  let payNow: string[] = [];
  if (payables.length > 0) {
    const start = dayStartUtc(now);
    const [wsBilled, platformBilled] = await Promise.all([
      billedSince(deps.prisma, workspaceId, start),
      billedSincePlatform(deps.ownerPrisma, start),
    ]);
    const allowanceLeft = cfg.dailyAllowance - wsBilled;
    const ceilingLeft = cfg.ceilingChecks - platformBilled;
    const headroom = Math.max(0, Math.min(allowanceLeft, ceilingLeft));
    payNow = payables.slice(0, headroom);
    if (payNow.length < payables.length) {
      held = ceilingLeft <= allowanceLeft ? "platform_spend_ceiling" : "workspace_allowance";
    }
  }

  let providerDown: ValidationProviderError | null = null;
  if (payNow.length > 0) {
    try {
      const results = await deps.provider.validateBatch(payNow);
      const byAddress = new Map(results.map((r) => [normalizeEmail(r.address), r]));
      for (const a of payNow) {
        const r = byAddress.get(a);
        // A provider that answered the batch but skipped an address gets the
        // held-not-guessed treatment: leave it pending for the next turn.
        if (!r) continue;
        resolutions.set(a, {
          verdict: r.verdict,
          via: "zerobounce",
          ...(r.subStatus ? { subStatus: r.subStatus } : {}),
          billed: true,
        });
      }
    } catch (err) {
      if (!(err instanceof ValidationProviderError)) throw err;
      // Typed refusal: persist the free-filter work below, hold the batch,
      // leave provider-bound items PENDING — never a guessed verdict.
      providerDown = err;
      held = "provider_unavailable";
    }
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  const resolved = await persistResolutions(deps, workspaceId, batchId, items, resolutions, suppressedSkip, now, cfg);

  if (held) {
    // Rising-edge pause event per hold episode: judge against the batch state
    // at TURN START (the in-turn resume flip to `running` must not defeat the
    // guard when the provider is still down).
    const wasHeldSame = batch.status === "held" && batch.heldReason === held;
    await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.validationBatch.updateMany({
        where: { id: batchId },
        data: { status: "held", heldReason: held, claimedUntil: null },
      }),
    );
    if (!wasHeldSame) {
      const pendingCount = await countPending(deps, workspaceId, batchId);
      await deps.publish({
        type: EVENT_TYPES.VALIDATION_PAUSED,
        workspaceId,
        payload: { batchId, reason: held, pendingCount },
      });
      if (held === "platform_spend_ceiling") {
        // The vendor-spine cost alert — loud in ops logs, honest in-product.
        console.error(
          `[validation] COST ALERT: platform daily spend ceiling reached — batch ${batchId} held with ${pendingCount} pending (new validation pauses until the next UTC day)`,
        );
      }
    }
    if (providerDown) throw providerDown; // queue retries with backoff
    return {
      ...base,
      status: "held",
      heldReason: held,
      resolved,
      requeue: true,
      requeueDelayMs: msToNextUtcDay(now),
      verdictsLanded: resolved > 0,
    };
  }

  const pendingLeft = await countPending(deps, workspaceId, batchId);
  if (pendingLeft === 0) {
    await finalizeIfDrained(deps, workspaceId, batchId, deps.now?.() ?? new Date());
    return { ...base, status: "completed", resolved, verdictsLanded: resolved > 0 };
  }
  await setBatch(deps, workspaceId, batchId, { claimedUntil: null });
  return { ...base, status: "running", resolved, requeue: true, verdictsLanded: resolved > 0 };
}

async function persistResolutions(
  deps: ValidationDeps,
  workspaceId: string,
  batchId: string,
  items: Array<{ id: string; contactId: string; address: string }>,
  resolutions: Map<string, Resolution>,
  suppressedSkip: Set<string>,
  now: Date,
  cfg: ValidationConfig,
): Promise<number> {
  if (resolutions.size === 0 && suppressedSkip.size === 0) return 0;
  const expiresAt = new Date(now.getTime() + cfg.ttlDays * 86_400_000);

  // GROUPED writes — a chunk persists in a handful of statements, not
  // per-address round-trips (an interactive tx has a hard time budget).
  interface Group {
    outcome: string;
    via: string;
    detail: string | null;
    billed: boolean;
    itemIds: string[];
    contactIds: string[];
    verdicted: boolean;
  }
  const groups = new Map<string, Group>();
  let resolved = 0;
  for (const item of items) {
    const r = resolutions.get(item.address);
    const g: Omit<Group, "itemIds" | "contactIds"> | null = r
      ? {
          outcome: r.verdict,
          via: r.via,
          detail: r.subStatus ?? null,
          billed: r.billed,
          verdicted: true,
        }
      : suppressedSkip.has(item.address)
        ? // Suppressed rows are SKIPPED, not verdicted: never billed, never
          // claimed valid — the contact stays `unverified`; the boundary's
          // suppression rail refuses it regardless.
          { outcome: "skipped_suppressed", via: "suppression", detail: null, billed: false, verdicted: false }
        : null;
    if (!g) continue;
    resolved += 1;
    const key = `${g.outcome}|${g.via}|${g.detail ?? ""}|${g.billed}`;
    const bucket = groups.get(key) ?? { ...g, itemIds: [], contactIds: [] };
    bucket.itemIds.push(item.id);
    bucket.contactIds.push(item.contactId);
    groups.set(key, bucket);
  }
  // Cache rows are address-level (deduped) — replace-then-insert so the whole
  // set lands in two statements. Cache HITS re-assert nothing.
  const cacheWrites = [...resolutions.entries()]
    .filter(([, r]) => r.via !== "cache")
    .map(([address, r]) => ({
      workspaceId,
      address,
      verdict: r.verdict,
      subStatus: r.subStatus ?? null,
      source: r.via,
      checkedAt: now,
      expiresAt,
      ...(r.billed ? { billedAt: now, costMicros: cfg.costPerCheckMicros } : {}),
    }));

  await withTenant(deps.prisma, { workspaceId }, async (tx) => {
    for (const g of groups.values()) {
      await tx.validationBatchItem.updateMany({
        where: { batchId, id: { in: g.itemIds } },
        data: { outcome: g.outcome, via: g.via, detail: g.detail, billed: g.billed },
      });
      if (g.verdicted) {
        // The verdict of record on the contact rows (the gate reads this) —
        // suppression stays authoritative regardless of verdict.
        await tx.contact.updateMany({
          where: { id: { in: g.contactIds } },
          data: { emailVerdict: g.outcome, emailVerdictCheckedAt: now, emailVerdictSource: g.via },
        });
      }
    }
    if (cacheWrites.length > 0) {
      await tx.emailValidationVerdict.deleteMany({
        where: { workspaceId, address: { in: cacheWrites.map((c) => c.address) } },
      });
      await tx.emailValidationVerdict.createMany({ data: cacheWrites });
    }
  });
  return resolved;
}

async function countPending(deps: ValidationDeps, workspaceId: string, batchId: string): Promise<number> {
  return withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatchItem.count({ where: { batchId, outcome: "pending" } }),
  );
}

/** Guarded completion transition — emits `validation.batch_completed.v1` exactly once. */
async function finalizeIfDrained(
  deps: ValidationDeps,
  workspaceId: string,
  batchId: string,
  now: Date,
): Promise<boolean> {
  const flipped = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatch.updateMany({
      where: { id: batchId, status: { not: "completed" } },
      data: { status: "completed", heldReason: null, claimedUntil: null, completedAt: now },
    }),
  );
  if (flipped.count === 0) return false;
  const [groups, billedAddresses, cacheHits, batch] = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    Promise.all([
      tx.validationBatchItem.groupBy({ by: ["outcome"], where: { batchId }, _count: { _all: true } }),
      // The COGS figure: one paid check per unique ADDRESS (duplicate rows
      // share it) — matches the cache rows' billedAt meter exactly.
      tx.validationBatchItem.findMany({
        where: { batchId, billed: true },
        select: { address: true },
        distinct: ["address"],
      }),
      tx.validationBatchItem.count({ where: { batchId, via: "cache" } }),
      tx.validationBatch.findUniqueOrThrow({ where: { id: batchId }, select: { source: true } }),
    ]),
  );
  const billed = billedAddresses.length;
  const count = (outcome: string): number =>
    groups.find((g) => g.outcome === outcome)?._count._all ?? 0;
  await deps.publish({
    type: EVENT_TYPES.VALIDATION_BATCH_COMPLETED,
    workspaceId,
    payload: {
      batchId,
      source: batch.source,
      total: groups.reduce((n, g) => n + g._count._all, 0),
      valid: count("valid"),
      risky: count("risky"),
      invalid: count("invalid"),
      skippedSuppressed: count("skipped_suppressed"),
      billed,
      cacheHits,
    },
  });
  return true;
}

async function setBatch(
  deps: ValidationDeps,
  workspaceId: string,
  batchId: string,
  data: Prisma.ValidationBatchUpdateManyMutationInput,
): Promise<void> {
  await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.validationBatch.updateMany({ where: { id: batchId }, data }),
  );
}

/** Drive a batch to a settled state in-process (tests + the single-add path
 *  when no queue is wired) — every turn through the same pinned pipeline. */
export async function runValidationBatchToSettled(
  deps: ValidationDeps,
  workspaceId: string,
  batchId: string,
  maxTurns = 50,
): Promise<ChunkResult> {
  let last: ChunkResult | null = null;
  for (let i = 0; i < maxTurns; i += 1) {
    last = await processValidationBatchChunk(deps, workspaceId, batchId);
    if (last.status === "completed" || last.status === "held" || !last.requeue) return last;
  }
  return last as ChunkResult;
}
