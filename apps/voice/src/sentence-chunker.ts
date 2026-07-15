/**
 * SentenceChunker — flushes speakable chunks at sentence ends so TTS starts
 * on the first complete sentence instead of the whole reply (the main
 * time-to-first-audio lever). Core behavior ported VERBATIM from the P3.0
 * spike (ADR-proven; the barge-in test pins it).
 *
 * `eagerFirst` (P3.1, cert run 3): the TURN's first chunk may flush at a
 * clause boundary instead of waiting out a long opening sentence — TTFA p95
 * was paying for the model's first-sentence length. First chunk only;
 * everything after speaks in full sentences as proven.
 */
export class SentenceChunker {
  private buffer = "";
  private emitted = false;

  constructor(private readonly eagerFirst = false) {}

  /** Feed a delta; returns any complete sentences ready for TTS. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    // Split on sentence enders followed by whitespace; keep the ender.
    for (;;) {
      const match = /[.!?…]["')\]]?\s/.exec(this.buffer);
      if (!match) break;
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) out.push(sentence);
    }
    // Long clause without an ender: flush at a comma past 80 chars so TTS
    // never sits on a run-on sentence.
    if (this.buffer.length > 80) {
      const comma = this.buffer.lastIndexOf(", ");
      if (comma > 40) {
        out.push(this.buffer.slice(0, comma + 1).trim());
        this.buffer = this.buffer.slice(comma + 2);
      }
    }
    // Eager first chunk: a clause is speakable — don't hold the caller for
    // the rest of a long opening sentence.
    if (this.eagerFirst && !this.emitted && out.length === 0 && this.buffer.length > 48) {
      const comma = this.buffer.lastIndexOf(", ");
      const cut = comma > 24 ? comma + 1 : -1;
      if (cut > 0) {
        out.push(this.buffer.slice(0, cut).trim());
        this.buffer = this.buffer.slice(cut + 1);
      }
    }
    if (out.length > 0) this.emitted = true;
    return out;
  }

  /** Whatever's left when the stream ends. */
  flush(): string | undefined {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : undefined;
  }
}
