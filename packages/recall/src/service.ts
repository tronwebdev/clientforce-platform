/**
 * The recall service (SPEC A, DEC-099) — one instance per live call.
 *
 * Everything the brain's tool calls go through, and the single place the three
 * hard guarantees are enforced:
 *
 * 1 · A LOOKUP NEVER TAKES THE CALL DOWN. Store errors, timeouts and budget
 *     exhaustion all come back as typed `RecallResult`s with a refusal reason.
 *     There is no throw path into the session — a database hiccup must degrade
 *     the answer, not drop the caller.
 * 2 · BOUNDED. Per-turn and per-call caps, plus a wall-clock timeout on every
 *     lookup. A live caller is waiting; an unbounded fetch is a hung line.
 * 3 · EVERY LOOKUP LEAVES A RECEIPT — including the ones that found nothing
 *     and the ones that were refused. An honest "I don't have that on record"
 *     is only auditable if the empty lookup is on the ledger too.
 *
 * Receipts BUFFER in memory and flush once at finalize, the `persistTranscript`
 * precedent. Writing mid-call would put an avoidable write on the audio path,
 * and the pacing work (DEC-092) exists precisely because that path is where
 * jitter becomes audible. The trade is explicit: a call whose process dies
 * before finalize loses its receipts, exactly as it already loses its
 * transcript.
 */
import {
  RECALL_FACETS,
  RECALL_MAX_LOOKUPS_PER_CALL,
  RECALL_MAX_LOOKUPS_PER_TURN,
  RECALL_TIMEOUT_MS,
  type RecallFacet,
  type RecallRefusalReason,
  type RecallResult,
} from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import {
  fetchBookings,
  fetchHistory,
  fetchKnowledge,
  fetchPipeline,
  fetchProfile,
} from "./fetchers";
import type { RecallDeps, RecallFetcher, RecallTarget } from "./types";

const FETCHERS: Record<RecallFacet, RecallFetcher> = {
  history: fetchHistory,
  pipeline: fetchPipeline,
  bookings: fetchBookings,
  profile: fetchProfile,
  knowledge: fetchKnowledge,
};

/** The honest empty-note per facet — spoken material, not error text. */
const EMPTY_NOTE: Record<RecallFacet, string> = {
  history: "There are no earlier messages or calls with this contact on record.",
  pipeline: "This contact is not enrolled in any campaign on record.",
  bookings: "There are no previous calls or bookings on record for this contact.",
  profile: "The contact record has no company, tags, lists or notes saved.",
  knowledge: "The business knowledge base has nothing on file matching that question.",
};

/** One buffered receipt — mirrors a `CallRetrieval` row. */
export interface RecallReceipt {
  seq: number;
  turn: number;
  facet: string;
  query: string;
  found: boolean;
  itemCount: number;
  latencyMs: number;
  refusalReason: RecallRefusalReason | null;
  sources: string[];
}

export class RecallService {
  private seq = 0;
  private lookupsThisCall = 0;
  private lookupsThisTurn = 0;
  private currentTurn = -1;
  private readonly receipts: RecallReceipt[] = [];

  constructor(
    private readonly deps: RecallDeps,
    private readonly target: RecallTarget,
    private readonly timeoutMs: number = RECALL_TIMEOUT_MS,
  ) {}

  /**
   * Run one scoped lookup and record its receipt.
   *
   * `turn` is the caller turn being served; a new turn resets the per-turn
   * budget. Never throws.
   */
  async lookup(facet: string, query: string, turn: number): Promise<RecallResult> {
    if (turn !== this.currentTurn) {
      this.currentTurn = turn;
      this.lookupsThisTurn = 0;
    }

    const known = (RECALL_FACETS as readonly string[]).includes(facet);
    if (!known) {
      // The tool schema constrains this, but a model can still produce an
      // out-of-enum string. Refuse by name rather than crashing the turn.
      return this.record(facet, query, turn, 0, {
        found: false,
        items: [],
        refusalReason: "UNKNOWN_FACET",
        facet: facet as RecallFacet,
      });
    }
    const typed = facet as RecallFacet;

    if (
      this.lookupsThisCall >= RECALL_MAX_LOOKUPS_PER_CALL ||
      this.lookupsThisTurn >= RECALL_MAX_LOOKUPS_PER_TURN
    ) {
      return this.record(typed, query, turn, 0, {
        facet: typed,
        found: false,
        items: [],
        refusalReason: "BUDGET_EXHAUSTED",
      });
    }

    this.lookupsThisCall++;
    this.lookupsThisTurn++;
    const started = Date.now();

    try {
      const outcome = await withTimeout(
        FETCHERS[typed](this.deps, this.target, query),
        this.timeoutMs,
      );
      if (outcome === TIMED_OUT) {
        return this.record(typed, query, turn, Date.now() - started, {
          facet: typed,
          found: false,
          items: [],
          refusalReason: "LOOKUP_TIMEOUT",
        });
      }
      const found = outcome.items.length > 0;
      return this.record(
        typed,
        query,
        turn,
        Date.now() - started,
        {
          facet: typed,
          found,
          items: outcome.items,
          note: found ? outcome.note : (outcome.note ?? EMPTY_NOTE[typed]),
        },
        outcome.sources,
      );
    } catch (err) {
      // Loud in the log, silent to the caller's ear — the model is told the
      // store could not be read and says so.
      console.error(
        `[recall] ${typed} lookup failed for call ${this.target.callId}:`,
        (err as Error).message,
      );
      return this.record(typed, query, turn, Date.now() - started, {
        facet: typed,
        found: false,
        items: [],
        refusalReason: "STORE_UNAVAILABLE",
      });
    }
  }

  private record(
    facet: string,
    query: string,
    turn: number,
    latencyMs: number,
    result: RecallResult,
    sources: string[] = [],
  ): RecallResult {
    this.receipts.push({
      seq: this.seq++,
      turn,
      facet,
      query,
      found: result.found,
      itemCount: result.items.length,
      latencyMs,
      refusalReason: result.refusalReason ?? null,
      sources,
    });
    return result;
  }

  /** Receipts recorded so far — the metrics summary and tests read this. */
  ledger(): RecallReceipt[] {
    return [...this.receipts];
  }

  /**
   * Persist the receipts. Idempotent on (callId, seq), so a retried finalize
   * writes each row exactly once — `persistTranscript`'s contract.
   */
  async flush(): Promise<number> {
    if (this.receipts.length === 0) return 0;
    const rows = this.receipts.map((r) => ({
      workspaceId: this.target.workspaceId,
      callId: this.target.callId,
      contactId: this.target.contactId,
      turn: r.turn,
      seq: r.seq,
      facet: r.facet,
      query: r.query,
      found: r.found,
      itemCount: r.itemCount,
      latencyMs: r.latencyMs,
      refusalReason: r.refusalReason,
      sources: r.sources,
    }));
    const result = await withTenant(
      this.deps.prisma as PrismaClient,
      { workspaceId: this.target.workspaceId },
      (tx) => tx.callRetrieval.createMany({ data: rows, skipDuplicates: true }),
    );
    return result.count;
  }
}

// ── timeout helper ──────────────────────────────────────────────────────────
const TIMED_OUT = Symbol("recall.timeout");

/**
 * Race a fetch against the clock. The loser is abandoned rather than
 * cancelled: Prisma gives no abort handle, and a stray query settling into the
 * void costs nothing, whereas holding a live caller does.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
