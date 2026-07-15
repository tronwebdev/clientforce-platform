import { Injectable } from "@nestjs/common";
import type { SenderHealthScore } from "@clientforce/core";

export interface SenderHealthResult {
  /** false when P5-W1's endpoint isn't configured/reachable → honest "pending". */
  wired: boolean;
  scores: SenderHealthScore[];
}

/**
 * B1 W4 (DEC-082): the interlock to P5-W1's sender health-score endpoint. The
 * backoffice CONSUMES health here and NOWHERE recomputes it. Until P5-W1 is on
 * main and its endpoint URL (`SENDER_HEALTH_URL`) is configured, `scores()`
 * returns `wired: false` and the fleet view shows an honest "pending P5-W1".
 * When P5-W1 lands, only this class changes — the fleet view already codes to
 * the `SenderHealthScore` contract.
 */
@Injectable()
export class SenderHealthClient {
  async scores(): Promise<SenderHealthResult> {
    const url = process.env.SENDER_HEALTH_URL;
    if (!url) return { wired: false, scores: [] };
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return { wired: false, scores: [] };
      const scores = (await res.json()) as SenderHealthScore[];
      return { wired: true, scores };
    } catch {
      return { wired: false, scores: [] };
    }
  }
}
