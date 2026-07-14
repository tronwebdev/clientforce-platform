/**
 * SentenceChunker — flushes speakable chunks at sentence ends so TTS starts
 * on the first complete sentence instead of the whole reply (the main
 * time-to-first-audio lever). Ported VERBATIM from the P3.0 spike (ADR-proven
 * behavior; the barge-in test pins it).
 */
export class SentenceChunker {
  private buffer = "";

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
    return out;
  }

  /** Whatever's left when the stream ends. */
  flush(): string | undefined {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : undefined;
  }
}
