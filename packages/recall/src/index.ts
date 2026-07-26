/**
 * @clientforce/recall — on-call contact awareness (SPEC A, DEC-094).
 *
 * The retrieval spine behind `lookup_contact_context`: question → scoped
 * lookup → grounded answer, with honest absence and a receipt per lookup.
 *
 * Channel-agnostic on purpose. Voice is the first consumer because a live call
 * is where prompt-stuffing fails hardest, but nothing here knows about audio —
 * the reply-draft and widget-chat surfaces can mount the same service against
 * the same facets when they need it.
 */
export { RecallService, type RecallReceipt } from "./service";
export { buildRecallTool } from "./tool";
export {
  fetchBookings,
  fetchHistory,
  fetchKnowledge,
  fetchPipeline,
  fetchProfile,
} from "./fetchers";
export { overlapScore, rankByQuery, terms } from "./rank";
export { spokenWhen } from "./when";
export type { FetchOutcome, RecallDeps, RecallFetcher, RecallTarget } from "./types";
