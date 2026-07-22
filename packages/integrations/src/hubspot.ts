/**
 * HubSpot adapter (INT W4, DEC-096) — one-way CRM push, transport + status
 * mapping ONLY (the Stripe/Calendly anatomy). Auth is a user-pasted PRIVATE-APP
 * token (the fields-connect tier — no OAuth clock, the W2/W3 token precedent;
 * marketplace framing is OUT per the dispatch), field-encrypted in
 * credentialsEnc. The two push actions upsert the lead as a HubSpot contact,
 * create/associate a Deal, and move its stage — no two-way sync (recorded Q).
 *
 * Classification is the vendor-spine contract: 401 → PROVIDER_AUTH (revoked),
 * 429 → RATE_LIMITED, 5xx → UNAVAILABLE (both transient), other 4xx → a TYPED
 * IntegrationDeliveryError (a CONFIG refusal — a bad pipeline/stage name or a
 * missing scope, never token death). The bearer is resolved OUTSIDE the network
 * try (the W3 lesson: a missing token is PROVIDER_AUTH, never "hubspot down").
 */
import { z } from "zod";
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type FieldsIntegrationAdapter,
  type IntegrationCredentials,
  type ProbeResult,
} from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The connect-fields body (API boundary DTO — the calendly/stripe twin). */
export const hubspotConnectFieldsSchema = z
  .object({
    apiToken: z.string().min(1).max(200),
    /** Optional: the pipeline `create_crm_deal` lands new deals in (default otherwise). */
    defaultPipeline: z.string().min(1).max(120).optional(),
  })
  .strict();
export type HubspotConnectFieldsDto = z.infer<typeof hubspotConnectFieldsSchema>;

export interface HubspotAccount {
  portalId: string;
  accountType?: string;
}

export class HubspotAdapter implements FieldsIntegrationAdapter {
  readonly provider = "hubspot" as const;
  /** No platform app credentials — private-app token, always connectable. */
  readonly configured = true;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: { baseUrl?: string; fetchImpl?: FetchLike }) {
    this.apiBase = (options?.baseUrl ?? process.env.HUBSPOT_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** The token probe: GET /account-info/v3/details → portalId (the label). */
  async account(creds: IntegrationCredentials): Promise<HubspotAccount> {
    const data = await this.call(creds, "GET", "/account-info/v3/details");
    const portalId =
      typeof data.portalId === "number" ? String(data.portalId) : typeof data.portalId === "string" ? data.portalId : "";
    if (!portalId) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "hubspot /account-info returned no portal id", false);
    }
    return { portalId, ...(typeof data.accountType === "string" ? { accountType: data.accountType } : {}) };
  }

  async probe(creds: IntegrationCredentials): Promise<ProbeResult> {
    const account = await this.account(creds);
    const label = `HubSpot (portal ${account.portalId})`;
    return { ok: true, detail: `hubspot reachable — ${label}`, accountLabel: label };
  }

  /** Upsert a HubSpot contact by email; returns the contact id. */
  async upsertContact(
    creds: IntegrationCredentials,
    contact: { email: string; firstName?: string | null; lastName?: string | null; company?: string | null },
  ): Promise<string> {
    const search = await this.call(creds, "POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: contact.email }] }],
      properties: ["email"],
      limit: 1,
    });
    const found = Array.isArray(search.results) ? (search.results as Array<{ id?: unknown }>) : [];
    if (found[0] && typeof found[0].id === "string") return found[0].id;
    const created = await this.call(creds, "POST", "/crm/v3/objects/contacts", {
      properties: {
        email: contact.email,
        ...(contact.firstName ? { firstname: contact.firstName } : {}),
        ...(contact.lastName ? { lastname: contact.lastName } : {}),
        ...(contact.company ? { company: contact.company } : {}),
      },
    });
    const id = typeof created.id === "string" ? created.id : "";
    if (!id) throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "hubspot contact create returned no id", true);
    return id;
  }

  /** Create a Deal; returns the deal id. */
  async createDeal(
    creds: IntegrationCredentials,
    deal: { dealname: string; pipeline?: string; stage?: string; amount?: number },
  ): Promise<string> {
    const created = await this.call(creds, "POST", "/crm/v3/objects/deals", {
      properties: {
        dealname: deal.dealname,
        ...(deal.pipeline ? { pipeline: deal.pipeline } : {}),
        ...(deal.stage ? { dealstage: deal.stage } : {}),
        ...(typeof deal.amount === "number" ? { amount: String(deal.amount) } : {}),
      },
    });
    const id = typeof created.id === "string" ? created.id : "";
    if (!id) throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "hubspot deal create returned no id", true);
    return id;
  }

  /** Associate a deal to a contact (v4 default association). */
  async associateDealToContact(creds: IntegrationCredentials, dealId: string, contactId: string): Promise<void> {
    await this.call(
      creds,
      "PUT",
      `/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/default/contacts/${encodeURIComponent(contactId)}`,
    );
  }

  /** Move a deal to a named stage (one-way). */
  async updateDealStage(creds: IntegrationCredentials, dealId: string, stage: string): Promise<void> {
    await this.call(creds, "PATCH", `/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
      properties: { dealstage: stage },
    });
  }

  /** Private-app tokens are revoked by deleting the app in HubSpot — no API. */
  async revoke(): Promise<void> {
    return;
  }

  private bearer(creds: IntegrationCredentials): Record<string, string> {
    const token = creds.apiToken;
    if (typeof token !== "string" || token.length === 0) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "Connection has no HubSpot token — reconnect with a private-app token",
        false,
      );
    }
    return { Authorization: `Bearer ${token}` };
  }

  /** One choke point: fetch → HTTP classification (HubSpot errors carry {category,message}). */
  private async call(
    creds: IntegrationCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    // Bearer OUTSIDE the network try — a missing token is PROVIDER_AUTH.
    const headers: Record<string, string> = {
      ...this.bearer(creds),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        `hubspot unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", "hubspot rate limited (429)", true);
    if (res.status >= 500) throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `hubspot error (HTTP ${res.status})`, true);
    if (res.status === 401) throw new IntegrationProviderError("PROVIDER_AUTH", "hubspot auth rejected (HTTP 401)", false);
    // Some endpoints (associations PUT) answer 204 with no body.
    if (res.status === 204) return {};
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      if (res.ok) return {};
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "hubspot returned a non-JSON response", true);
    }
    if (res.ok) return data;
    // Any other 4xx = a CONFIG refusal (bad pipeline/stage, missing scope) —
    // typed, rendered at the run row, never token death or vendor-down.
    const message = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
    const category = typeof data.category === "string" ? data.category : "request_failed";
    throw new IntegrationDeliveryError(category, `hubspot refused the request (${message})`);
  }
}
