/**
 * LH1 (DEC-087): ONE validation service behind an adapter — the vendor-spine
 * seam. Providers do VERIFICATION ONLY: free filters, caching, spend rails,
 * verdict persistence and the enrollment gate all live outside the adapter,
 * so swapping ZeroBounce out later touches nothing but a class.
 */
import type { EventType } from "@clientforce/events";

/** A provider can only ever say valid / risky / invalid — `unverified`
 *  means "no verdict yet" and is never a provider answer. */
export type ProviderVerdict = "valid" | "risky" | "invalid";

export interface ProviderResult {
  /** Normalized (lowercased) address, echoing the request. */
  address: string;
  verdict: ProviderVerdict;
  /** Provider sub-status (e.g. "mailbox_not_found") — report row detail. */
  subStatus?: string;
}

export interface EmailValidationProvider {
  readonly name: string;
  /**
   * Validate a set of addresses (order-independent; the adapter chunks to
   * its own API limits). MUST either return a result for every address or
   * throw a typed {@link ValidationProviderError} — never partial silence.
   */
  validateBatch(addresses: string[]): Promise<ProviderResult[]>;
  /** Vendor-spine preflight probe — cheap auth/reachability check. */
  preflight(): Promise<{ ok: boolean; detail: string }>;
}

export type ValidationProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_AUTH";

/**
 * The typed refusal on provider failure. A provider outage must NEVER
 * silently enroll unverified addresses — callers hold the batch (items stay
 * `pending`, contacts stay `unverified` and held at the gate) and surface
 * the honest "validation queued" state.
 */
export class ValidationProviderError extends Error {
  constructor(
    public readonly code: ValidationProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ValidationProviderError";
  }
}

/** Structural twin of the platform events publisher (Bus or inline). */
export interface ValidationEventInput {
  type: EventType;
  workspaceId: string;
  contactId?: string;
  campaignId?: string;
  payload: Record<string, unknown>;
}
export type ValidationEventPublish = (event: ValidationEventInput) => Promise<void>;

/** `node:dns/promises`-compatible MX resolver — injected so CI mocks it
 *  (the DNS_CHECK_DEPS precedent). */
export type ResolveMx = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
