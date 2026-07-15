import { Injectable } from "@nestjs/common";
import { computeSenderHealth, loadSenderLedgerSample, senderLedgerChannel } from "@clientforce/channels";
import type { SenderHealthScore } from "@clientforce/core";
import { BackofficeDb } from "./backoffice-db.service";

export interface SenderHealthResult {
  /** true once P5-W1's computation ran (in-process, always available on main). */
  wired: boolean;
  scores: SenderHealthScore[];
}

/**
 * B1 W4 (DEC-082) × P5-W1 (DEC-083): the fleet health interlock. P5-W1 landed on
 * main, so the backoffice CONSUMES its SHARED `computeSenderHealth` per sender —
 * the SAME pure function tenant land and the `/senders/:id/health` endpoint use.
 * The score math is NEVER forked here; the backoffice only enumerates senders
 * (cross-tenant via the RLS-exempt client) and reads P5-W1's number. Below P5-W1's
 * sample floor the score is `null` / status `low_data` — an honest "warming",
 * never a fake number. (This is the "only this class changes when P5-W1 lands"
 * seam the W4 stub promised.)
 */
@Injectable()
export class SenderHealthClient {
  constructor(private readonly db: BackofficeDb) {}

  async scores(now: Date = new Date()): Promise<SenderHealthResult> {
    try {
      const senders = await this.db.client.senderConnection.findMany({
        select: { id: true, workspaceId: true, type: true },
      });
      const scores: SenderHealthScore[] = [];
      for (const s of senders) {
        const sample = await loadSenderLedgerSample(this.db.client, {
          workspaceId: s.workspaceId,
          senderId: s.id,
          channel: senderLedgerChannel(s),
          now,
        });
        const computed = computeSenderHealth(sample);
        scores.push({
          senderId: s.id,
          workspaceId: s.workspaceId,
          score: computed.score,
          status: computed.band ?? computed.state,
        });
      }
      return { wired: true, scores };
    } catch {
      // Degrade honestly if the ledger read fails — never a fabricated score.
      return { wired: false, scores: [] };
    }
  }
}
