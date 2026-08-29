/**
 * B6 (DEC-131, ruling 1): the Apollo adapter — provider #1 behind the
 * agnostic seam. Server-side only: the key reads from APOLLO_API_KEY
 * (Key Vault secret APOLLO-API-KEY in deployed environments) and NEVER
 * reaches a client. Keyless = `configured() === false`; every call without
 * a key throws the typed PROVIDER_AUTH refusal naming the secret — the
 * ZeroBounce posture, never fabricated rows.
 *
 * Transport notes: Apollo's mixed_people/search returns identity fields
 * with the email locked behind a paid reveal (people/match) — exactly the
 * masked-until-revealed contract the surface wants. Only the fields the
 * candidate shape needs are mapped; everything else rides `raw` at reveal.
 */
import {
  LeadProviderError,
  type LeadCandidate,
  type LeadSearchFilters,
  type LeadSearchProvider,
  type RevealedContact,
} from "./types";

const APOLLO_API = "https://api.apollo.io/api/v1";

interface ApolloPerson {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email_status?: string;
  organization?: { name?: string; estimated_num_employees?: number };
  city?: string;
  state?: string;
  email?: string;
  phone_numbers?: Array<{ sanitized_number?: string }>;
}

export class ApolloProvider implements LeadSearchProvider {
  readonly name = "apollo";

  constructor(private readonly apiKey = process.env.APOLLO_API_KEY ?? "") {}

  configured(): boolean {
    return this.apiKey.length > 0;
  }

  private requireKey(): void {
    if (!this.configured()) {
      throw new LeadProviderError(
        "PROVIDER_AUTH",
        "APOLLO_API_KEY is not set. In deployed environments it resolves from Key Vault secret APOLLO-API-KEY.",
      );
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    this.requireKey();
    const res = await fetch(`${APOLLO_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      throw new LeadProviderError("PROVIDER_AUTH", `Apollo refused the key (${res.status}).`);
    }
    if (res.status === 429) {
      throw new LeadProviderError("PROVIDER_RATE_LIMITED", "Apollo rate limit hit — try again shortly.");
    }
    if (!res.ok) {
      throw new LeadProviderError("PROVIDER_UNAVAILABLE", `Apollo answered ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  async preflight(): Promise<void> {
    await this.post("/auth/health", {});
  }

  async searchPeople(filters: LeadSearchFilters, limit: number): Promise<LeadCandidate[]> {
    const body: Record<string, unknown> = {
      per_page: Math.min(limit, 25),
      ...(filters.query ? { q_keywords: filters.query } : {}),
      ...(filters.location ? { person_locations: [filters.location] } : {}),
      ...(filters.titles ? { person_titles: filters.titles.split("|") } : {}),
    };
    const data = await this.post<{ people?: ApolloPerson[] }>("/mixed_people/search", body);
    return (data.people ?? []).map((p) => this.toCandidate(p));
  }

  private toCandidate(p: ApolloPerson): LeadCandidate {
    return {
      provider: this.name,
      providerRef: p.id,
      kind: "person",
      name: p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") ?? "Unknown",
      title: p.title ?? null,
      company: p.organization?.name ?? null,
      location: [p.city, p.state].filter(Boolean).join(", ") || null,
      headcount: p.organization?.estimated_num_employees ?? null,
      // Apollo withholds the address pre-reveal; the mask is honest.
      maskedEmail: p.email_status ? "•••••••••@…" : null,
      maskedPhone: null,
      warmSignals: [],
    };
  }

  async reveal(providerRef: string): Promise<RevealedContact> {
    const data = await this.post<{ person?: ApolloPerson & Record<string, unknown> }>(
      "/people/match",
      { id: providerRef, reveal_personal_emails: false },
    );
    const p = data.person;
    if (!p) throw new LeadProviderError("PROVIDER_UNAVAILABLE", "Apollo returned no person for that reveal.");
    return {
      email: p.email ?? null,
      phone: p.phone_numbers?.[0]?.sanitized_number ?? null,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      title: p.title ?? null,
      company: p.organization?.name ?? null,
      raw: p as Record<string, unknown>,
    };
  }
}
