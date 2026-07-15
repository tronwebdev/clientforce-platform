/**
 * ZeroBounce adapter (LH1, DEC-087 — provider OWNER-LOCKED 2026-07-15).
 * Transport + status mapping ONLY; the adapter keeps the vendor swappable
 * but do not re-propose the provider.
 *
 * Uses the JSON batch endpoint (`POST /v2/validatebatch`, chunked to
 * {@link ZEROBOUNCE_BATCH_MAX}) for every batch size — the file-based
 * sendfile API is a drop-in upgrade behind this same seam if volumes ever
 * demand it (documented default, logged in the DEC).
 */
import { ZEROBOUNCE_BATCH_MAX } from "./constants";
import {
  ValidationProviderError,
  type EmailValidationProvider,
  type ProviderResult,
  type ProviderVerdict,
} from "./types";

/**
 * ZeroBounce status → the owner-locked verdict enum. Pinned by fixtures —
 * every status class has one. The safety stance: anything deliverability-
 * hostile (spamtrap/abuse) is INVALID outright; anything uncertain
 * (catch-all/unknown/do_not_mail) is RISKY — held by default policy, never
 * silently sent.
 */
export const ZEROBOUNCE_STATUS_MAP: Record<string, ProviderVerdict> = {
  valid: "valid",
  invalid: "invalid",
  spamtrap: "invalid",
  abuse: "invalid",
  "catch-all": "risky",
  catch_all: "risky",
  unknown: "risky",
  do_not_mail: "risky",
};

interface ZbBatchEntry {
  address?: string;
  email_address?: string;
  status?: string;
  sub_status?: string;
}

export class ZeroBounceProvider implements EmailValidationProvider {
  readonly name = "zerobounce";

  constructor(
    private readonly apiKey = process.env.ZEROBOUNCE_API_KEY,
    private readonly bulkBaseUrl = process.env.ZEROBOUNCE_BULK_BASE_URL ?? "https://bulkapi.zerobounce.net",
    private readonly baseUrl = process.env.ZEROBOUNCE_BASE_URL ?? "https://api.zerobounce.net",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private key(): string {
    if (!this.apiKey) {
      throw new ValidationProviderError(
        "PROVIDER_AUTH",
        "ZEROBOUNCE_API_KEY is not set. In deployed environments it resolves from Key Vault secret ZEROBOUNCE-API-KEY.",
        false,
      );
    }
    return this.apiKey;
  }

  /** Cheap auth/reachability probe (credit balance) — the preflight. */
  async preflight(): Promise<{ ok: boolean; detail: string }> {
    const key = this.key();
    const res = await this.request(`${this.baseUrl}/v2/getcredits?api_key=${encodeURIComponent(key)}`, {
      method: "GET",
    });
    const body = (await res.json().catch(() => ({}))) as { Credits?: string };
    const credits = Number(body.Credits ?? -1);
    if (credits < 0) {
      throw new ValidationProviderError("PROVIDER_AUTH", "ZeroBounce rejected the API key (getcredits -1)", false);
    }
    return { ok: true, detail: `zerobounce reachable — ${credits} credits remaining` };
  }

  async validateBatch(addresses: string[]): Promise<ProviderResult[]> {
    const key = this.key();
    const out: ProviderResult[] = [];
    for (let i = 0; i < addresses.length; i += ZEROBOUNCE_BATCH_MAX) {
      const slice = addresses.slice(i, i + ZEROBOUNCE_BATCH_MAX);
      const res = await this.request(`${this.bulkBaseUrl}/v2/validatebatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          email_batch: slice.map((email_address) => ({ email_address })),
        }),
      });
      const body = (await res.json().catch(() => null)) as { email_batch?: ZbBatchEntry[] } | null;
      const entries = body?.email_batch;
      if (!Array.isArray(entries)) {
        throw new ValidationProviderError(
          "PROVIDER_UNAVAILABLE",
          "ZeroBounce returned an unreadable batch response",
          true,
        );
      }
      const byAddress = new Map<string, ZbBatchEntry>();
      for (const e of entries) {
        const addr = (e.address ?? e.email_address ?? "").toLowerCase();
        if (addr) byAddress.set(addr, e);
      }
      for (const address of slice) {
        const entry = byAddress.get(address.toLowerCase());
        // A missing or unmapped status lands RISKY (held, never silently
        // sent) rather than inventing validity the provider never asserted.
        const status = entry?.status?.toLowerCase().trim() ?? "";
        out.push({
          address: address.toLowerCase(),
          verdict: ZEROBOUNCE_STATUS_MAP[status] ?? "risky",
          ...(entry?.sub_status ? { subStatus: entry.sub_status } : status && !ZEROBOUNCE_STATUS_MAP[status] ? { subStatus: status } : {}),
        });
      }
    }
    return out;
  }

  /** Fetch with typed failure classification (never a bare throw). */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new ValidationProviderError(
        "PROVIDER_UNAVAILABLE",
        `ZeroBounce unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) {
      throw new ValidationProviderError("PROVIDER_RATE_LIMITED", "ZeroBounce rate limit (HTTP 429)", true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ValidationProviderError("PROVIDER_AUTH", `ZeroBounce auth failed (HTTP ${res.status})`, false);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ValidationProviderError(
        "PROVIDER_UNAVAILABLE",
        `ZeroBounce HTTP ${res.status} ${detail.slice(0, 200)}`,
        res.status >= 500,
      );
    }
    return res;
  }
}
