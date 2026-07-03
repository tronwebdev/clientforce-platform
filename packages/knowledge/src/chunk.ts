/**
 * Paragraph-boundary-aware chunking: ~1,000-token windows with ~150-token
 * overlap. Token counts are estimated (chars/4) — good enough for windowing;
 * exact counts are the embedder's concern.
 */
export interface Chunk {
  content: string;
  tokens: number;
}

const TARGET_TOKENS = 1_000;
const OVERLAP_TOKENS = 150;

export const estimateTokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4));

export function chunkText(text: string): Chunk[] {
  const paragraphs = text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.join("\n");
    chunks.push({ content, tokens: estimateTokens(content) });
    // Seed the next window with trailing paragraphs up to the overlap budget.
    const overlap: string[] = [];
    let overlapTokens = 0;
    for (let i = current.length - 1; i >= 0 && overlapTokens < OVERLAP_TOKENS; i--) {
      const p = current[i]!;
      overlap.unshift(p);
      overlapTokens += estimateTokens(p);
    }
    current = overlap.length < current.length ? overlap : [];
    currentTokens = current.reduce((n, p) => n + estimateTokens(p), 0);
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (paraTokens > TARGET_TOKENS) {
      // Oversized paragraph: hard-split on sentence-ish boundaries.
      flush();
      const pieces = para.match(/[^.!?]+[.!?]*/g) ?? [para];
      let buf = "";
      for (const piece of pieces) {
        if (estimateTokens(buf + piece) > TARGET_TOKENS && buf) {
          chunks.push({ content: buf.trim(), tokens: estimateTokens(buf) });
          buf = "";
        }
        buf += piece;
      }
      if (buf.trim()) chunks.push({ content: buf.trim(), tokens: estimateTokens(buf) });
      current = [];
      currentTokens = 0;
      continue;
    }
    if (currentTokens + paraTokens > TARGET_TOKENS && current.length > 0) flush();
    current.push(para);
    currentTokens += paraTokens;
  }
  if (current.length > 0) {
    const content = current.join("\n");
    chunks.push({ content, tokens: estimateTokens(content) });
  }
  return chunks;
}
