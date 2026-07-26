/**
 * Recall types (SPEC A, DEC-094) — what a fetcher needs and what it returns.
 */
import type { AiGateway } from "@clientforce/ai";
import type { PrismaClient } from "@clientforce/db";
import type { RecallItem } from "@clientforce/core";

/**
 * The contact this call is about. Every fetcher is scoped to it — there is no
 * "look up any contact" path, so a caller can never be told about somebody
 * else's record by asking cleverly.
 */
export interface RecallTarget {
  workspaceId: string;
  contactId: string;
  agentId: string;
  /** The campaign this call belongs to — used to rank membership, never to
   *  restrict: a caller asking "what else am I signed up for" deserves the
   *  whole picture their own record holds. */
  campaignId: string;
  /** Excluded from `history` so the agent never "remembers" the call it is on. */
  callId: string;
}

export interface RecallDeps {
  prisma: PrismaClient;
  /** Only the `knowledge` facet needs it (embedding the question). */
  gateway?: AiGateway;
}

/** What a fetcher returns — the service wraps it into a `RecallResult`. */
export interface FetchOutcome {
  items: RecallItem[];
  /** Provenance ids for the receipt — row ids, chunk ids, campaign ids. */
  sources: string[];
  /** Honest note about truncation or a partial store. */
  note?: string;
}

export type RecallFetcher = (
  deps: RecallDeps,
  target: RecallTarget,
  query: string,
) => Promise<FetchOutcome>;
