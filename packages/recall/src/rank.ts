/**
 * Deterministic relevance ranking (SPEC A, DEC-099).
 *
 * The `history` and `profile` facets fetch a bounded recent window and then
 * rank it against the caller's question. That ranking is a PURE STRING
 * FUNCTION, not a model call and not an embedding: a live call cannot pay a
 * second round trip to decide which of twelve messages to read, and a
 * deterministic ranker means the same question against the same record always
 * produces the same receipt — which is what makes the receipt auditable.
 *
 * (`knowledge` is the exception and ranks by real embeddings — it searches a
 * corpus far too large for recency to be a sane prior.)
 */

/** Words too common to carry intent — dropping them stops "what did we talk
 *  about" from matching every row equally on "what"/"we"/"about". */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "about", "is", "are", "was", "were", "be", "been", "do",
  "did", "does", "have", "has", "had", "i", "you", "we", "they", "he", "she",
  "it", "me", "my", "our", "your", "us", "them", "this", "that", "these",
  "those", "what", "when", "where", "who", "how", "why", "which", "there",
  "so", "just", "can", "could", "would", "should", "will", "any", "some",
]);

/** Lowercased, de-punctuated, stop-worded content terms. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Overlap score in [0,1]: the share of the question's content terms that
 * appear in the candidate. Prefix matching (≥4 chars) catches the obvious
 * morphology ("pricing" ↔ "price") without a stemmer's false positives.
 */
export function overlapScore(queryTerms: string[], candidate: string): number {
  if (queryTerms.length === 0) return 0;
  const hay = candidate.toLowerCase();
  let hits = 0;
  for (const t of queryTerms) {
    if (hay.includes(t) || (t.length >= 4 && hay.includes(t.slice(0, 4)))) hits++;
  }
  return hits / queryTerms.length;
}

/**
 * Rank recent rows against the question, then take the top `limit`.
 *
 * Recency is the TIE-BREAKER, not a weighted term — a question that matches
 * nothing (the "have we spoken before?" case, which carries no content terms
 * at all) falls through to pure recency, which is exactly the right answer
 * there. A question that does match pulls the matching rows up regardless of
 * age, which is the "what did you say about pricing" case.
 */
export function rankByQuery<T>(
  rows: readonly T[],
  query: string,
  text: (row: T) => string,
  limit: number,
): T[] {
  const qt = terms(query);
  return rows
    .map((row, index) => ({ row, index, score: overlapScore(qt, text(row)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.row);
}
