/**
 * B6 (DEC-131, ruling 1): the provider-agnostic lead-search seam. Adapters do
 * TRANSPORT + shape mapping only (the integrations invariant); scoring is
 * ours (core `icp`), suppression and pricing live in the service layer, and
 * a keyless adapter answers honestly — never with fabricated rows.
 *
 * B6.5 (DEC-150): the provider is PLATFORM INFRASTRUCTURE. The user never
 * connects it, never authenticates it and never learns its name — they pay
 * in credits. Nothing about the vendor may reach the UI.
 */
export type LeadProviderErrorKind = "PROVIDER_AUTH" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RATE_LIMITED";

export class LeadProviderError extends Error {
  constructor(
    public readonly kind: LeadProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** A candidate BEFORE reveal — identity shown, contact details withheld. */
export interface LeadCandidate {
  provider: string;
  providerRef: string;
  kind: "person" | "company";
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  headcount: number | null;
  /** Masked at the PROVIDER boundary — the local part never reaches us
   *  before a paid reveal. */
  maskedEmail: string | null;
  maskedPhone: string | null;
  /** Provider-derived warm signals (job postings, funding, tech) — typed by
   *  the core intent registry; empty for keyless/own-data candidates. */
  warmSignals: Array<{ type: string; detail: string }>;
}

export interface RevealedContact {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  raw: Record<string, unknown>;
}

export interface LeadSearchFilters {
  /** Free text (Direct people search). */
  query?: string;
  /** Registry-keyed filter values (shape-dependent keys). */
  [key: string]: string | undefined;
}

export interface LeadSearchProvider {
  readonly name: string;
  /**
   * False = the platform holds no key for this adapter. This is an OPERATOR
   * condition, never a user-facing state (ADDENDUM_5 §1): the platform holds
   * one key, one vendor relationship, one bill. A caller must render
   * "Search is temporarily unavailable — nothing for you to fix" and must
   * never name a vendor or offer to connect one.
   */
  configured(): boolean;
  searchPeople(filters: LeadSearchFilters, limit: number): Promise<LeadCandidate[]>;
  reveal(providerRef: string): Promise<RevealedContact>;
  /** Cheap auth probe. Throws LeadProviderError on a dead key. */
  preflight(): Promise<void>;
}
