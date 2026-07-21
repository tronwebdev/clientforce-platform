/**
 * Integrations surface API (INT W1, DEC-093) — the ONE connection model:
 * connect (OAuth start → web callback → complete), probe-backed status,
 * config, disconnect, and the drawer's audit trail. Mutations are
 * OWNER/ADMIN (the senders precedent); refusals are typed 422s whose
 * `detail` renders verbatim in the UI (the SC/#94 convention). Vendor
 * outages map to 502 — a Slack blip is not the caller's fault.
 */
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  INTEGRATION_REFUSALS,
  completeIntegrationSchema,
  integrationConfigSchemas,
  isIntegrationProvider,
  updateIntegrationSchema,
  type IntegrationDto,
  type IntegrationProvider,
} from "@clientforce/core";
import { Role, type Prisma } from "@clientforce/db";
import {
  GoogleCalendarAdapter,
  IntegrationDeliveryError,
  IntegrationProviderError,
  IntegrationRefusedError,
  SlackAdapter,
  calendlyConnectFieldsSchema,
  completeConnect,
  connectCalendlyFields,
  decryptCredentials,
  disconnectIntegration,
  getIntegration,
  listIntegrations,
  oauthAdapterFor,
  probeIntegration,
  toIntegrationDto,
  withFreshCredentials,
  type IntegrationsDeps,
} from "@clientforce/integrations";
import { z, type ZodTypeAny } from "zod";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { INTEGRATIONS_DEPS } from "./integrations.providers";
import { mintOAuthState, verifyOAuthState } from "./oauth-state";

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/** The web-origin OAuth callback this API hands to the vendor. */
function redirectUriFor(provider: IntegrationProvider): string {
  const base = (process.env.WEB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/integrations/callback/${provider}`;
}

/**
 * INT W2 (DEC-094): the public base vendor webhooks must reach — the API
 * service itself (Calendly POSTs to /webhooks/calendly, which lives HERE,
 * never on the web app). Deriving it from the request origin is unreliable
 * behind ingress, so it is env-pinned: INTEGRATIONS_WEBHOOK_BASE (bicep param
 * `integrationsWebhookBase`, the webAppUrl pattern), falling back to
 * PUBLIC_API_URL (the Twilio-signature base) and finally localhost for dev.
 */
function webhookBase(): string {
  return (
    process.env.INTEGRATIONS_WEBHOOK_BASE ??
    process.env.PUBLIC_API_URL ??
    `http://localhost:${process.env.PORT ?? 3001}`
  ).replace(/\/$/, "");
}

@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(INTEGRATIONS_DEPS) private readonly deps: IntegrationsDeps,
  ) {}

  private provider(raw: string): IntegrationProvider {
    if (!isIntegrationProvider(raw)) {
      throw new UnprocessableEntityException({
        message: "Unknown provider",
        detail: INTEGRATION_REFUSALS.UNKNOWN_PROVIDER,
      });
    }
    return raw;
  }

  /** Map spine errors to transport-honest HTTP (422 refusal / 502 vendor). */
  private rethrow(err: unknown): never {
    if (err instanceof IntegrationRefusedError) {
      throw new UnprocessableEntityException({ message: "Integration refused", detail: err.detail });
    }
    if (err instanceof IntegrationProviderError) {
      if (err.code === "PROVIDER_AUTH") {
        throw new UnprocessableEntityException({ message: "Provider rejected the credentials", detail: err.message });
      }
      throw new BadGatewayException({ message: "Provider unavailable", detail: err.message });
    }
    // Review-round hardening: the vendor's request/config refusals
    // (invalid_code, code_already_used, missing_scope …) are ROUTINE on the
    // connect/options paths — typed 422 with the owner-readable detail,
    // never a raw 500 (the message carries the vendor error name only,
    // never token bytes).
    if (err instanceof IntegrationDeliveryError) {
      throw new UnprocessableEntityException({ message: "Provider refused the request", detail: err.message });
    }
    throw err;
  }

  @Get()
  async list(): Promise<{ integrations: IntegrationDto[] }> {
    const rows = await listIntegrations(this.deps, this.tenant.workspaceId);
    return { integrations: rows.map(toIntegrationDto) };
  }

  @Get(":provider")
  async detail(@Param("provider") rawProvider: string): Promise<{ integration: IntegrationDto | null }> {
    const provider = this.provider(rawProvider);
    const row = await getIntegration(this.deps, this.tenant.workspaceId, provider);
    return { integration: row ? toIntegrationDto(row) : null };
  }

  /**
   * OAuth start: mint the signed state, return the vendor authorize URL.
   * Refuses typed when the platform app credentials are absent — the UI says
   * so instead of a broken redirect (honest owner-clock state).
   */
  @Post(":provider/connect")
  @Roles(Role.OWNER, Role.ADMIN)
  connect(@Param("provider") rawProvider: string): { authorizeUrl: string } {
    const provider = this.provider(rawProvider);
    try {
      // W2: fields providers (calendly) refuse the OAuth path typed — they
      // connect through POST :provider/connect-fields instead.
      const adapter = oauthAdapterFor(this.deps, provider);
      if (!adapter.configured) {
        throw new UnprocessableEntityException({
          message: "Integration not configured",
          detail: INTEGRATION_REFUSALS.NOT_CONFIGURED,
        });
      }
      const state = mintOAuthState(this.tenant.workspaceId, provider);
      return { authorizeUrl: adapter.authorizeUrl({ redirectUri: redirectUriFor(provider), state }) };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /**
   * INT W2 (DEC-094): the FIELDS connect path (calendly only) — the non-OAuth
   * connect W1 reserved. Body {schedulingUrl?, apiToken?}: link-only tier
   * probes the link live and stores config.schedulingUrl (no credentialsEnc);
   * the token tier additionally probes /users/me, mints the per-workspace
   * webhookToken + signing key, and creates the idempotent webhook
   * subscription pointing at `<INTEGRATIONS_WEBHOOK_BASE>/webhooks/calendly
   * ?token=…` (the API's own public URL — the webhook must hit the API
   * service). PAT + signing key + subscription URI ride credentialsEnc.
   */
  @Post(":provider/connect-fields")
  @Roles(Role.OWNER, Role.ADMIN)
  async connectFields(
    @Param("provider") rawProvider: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ integration: IntegrationDto }> {
    const provider = this.provider(rawProvider);
    if (provider !== "calendly") {
      throw new UnprocessableEntityException({
        message: "Integration refused",
        detail: `${provider} connects with OAuth — use the connect flow`,
      });
    }
    const dto = parse(calendlyConnectFieldsSchema, body);
    try {
      const row = await connectCalendlyFields(this.deps, {
        workspaceId: this.tenant.workspaceId,
        fields: dto,
        webhookUrlFor: (token) => `${webhookBase()}/webhooks/calendly?token=${token}`,
        ...(req.auth ? { connectedById: req.auth.user.id } : {}),
      });
      return { integration: toIntegrationDto(row) };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** OAuth completion — the web callback forwards code+state verbatim. */
  @Post(":provider/complete")
  @Roles(Role.OWNER, Role.ADMIN)
  async complete(
    @Param("provider") rawProvider: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ integration: IntegrationDto }> {
    const provider = this.provider(rawProvider);
    const dto = parse(completeIntegrationSchema, body);
    const state = verifyOAuthState(dto.state, { workspaceId: this.tenant.workspaceId, provider });
    if (!state) {
      throw new UnprocessableEntityException({
        message: "Invalid OAuth state",
        detail: INTEGRATION_REFUSALS.STATE_INVALID,
      });
    }
    try {
      const row = await completeConnect(this.deps, {
        workspaceId: this.tenant.workspaceId,
        provider,
        code: dto.code,
        redirectUri: redirectUriFor(provider),
        ...(req.auth ? { connectedById: req.auth.user.id } : {}),
      });
      return { integration: toIntegrationDto(row) };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** The live token probe behind "Sync now" / status refresh. */
  @Post(":provider/probe")
  @Roles(Role.OWNER, Role.ADMIN)
  async probe(@Param("provider") rawProvider: string): Promise<{ status: string; detail: string }> {
    const provider = this.provider(rawProvider);
    try {
      return await probeIntegration(this.deps, { workspaceId: this.tenant.workspaceId, provider });
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** Per-provider config (Slack: channel + notification toggles). */
  @Patch(":provider")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Param("provider") rawProvider: string, @Body() body: unknown): Promise<{ integration: IntegrationDto }> {
    const provider = this.provider(rawProvider);
    const dto = parse(updateIntegrationSchema, body);
    const config = parse(integrationConfigSchemas[provider], dto.config);
    const row = await getIntegration(this.deps, this.tenant.workspaceId, provider);
    if (!row) {
      throw new UnprocessableEntityException({
        message: "Not connected",
        detail: INTEGRATION_REFUSALS.NOT_CONNECTED,
      });
    }
    const updated = await this.tenant.run((tx) =>
      tx.integration.update({ where: { id: row.id }, data: { config: config as Prisma.InputJsonValue } }),
    );
    return { integration: toIntegrationDto(updated) };
  }

  @Delete(":provider")
  @Roles(Role.OWNER, Role.ADMIN)
  async disconnect(@Param("provider") rawProvider: string): Promise<{ ok: true }> {
    const provider = this.provider(rawProvider);
    try {
      await disconnectIntegration(this.deps, { workspaceId: this.tenant.workspaceId, provider });
      return { ok: true };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /**
   * Vendor-side option listings for the config UI, per provider:
   * slack `kind=channels` (W1, byte-identical) · gcal `kind=calendars`
   * (W2 — the calendar picker; each option carries the calendar's own
   * timeZone, stored into config at pick time; listed on a FRESH token via
   * `withFreshCredentials`). Anything else refuses typed.
   */
  @Get(":provider/options")
  @Roles(Role.OWNER, Role.ADMIN)
  async options(
    @Param("provider") rawProvider: string,
    @Query("kind") kind: string | undefined,
  ): Promise<{ options: Array<{ id: string; name: string; timeZone?: string }> }> {
    const provider = this.provider(rawProvider);
    const supported = (provider === "slack" && kind === "channels") || (provider === "gcal" && kind === "calendars");
    if (!supported) {
      throw new UnprocessableEntityException({
        message: "Unknown option kind",
        detail: `No "${kind ?? ""}" options exist for ${provider}`,
      });
    }
    const row = await getIntegration(this.deps, this.tenant.workspaceId, provider);
    if (!row) {
      throw new UnprocessableEntityException({
        message: "Not connected",
        detail: INTEGRATION_REFUSALS.NOT_CONNECTED,
      });
    }
    try {
      if (provider === "gcal") {
        const adapter = oauthAdapterFor(this.deps, provider) as GoogleCalendarAdapter;
        const calendars = await withFreshCredentials(this.deps, row, (creds) => adapter.listCalendars(creds));
        return { options: calendars };
      }
      const adapter = oauthAdapterFor(this.deps, provider) as SlackAdapter;
      const channels = await adapter.listChannels(decryptCredentials(row));
      return { options: channels };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** The drawer audit trail: delivery rows + the integration.* ledger rows. */
  @Get(":provider/activity")
  async activity(@Param("provider") rawProvider: string): Promise<{
    deliveries: Array<{ id: string; kind: string; status: string; detail: unknown; createdAt: string }>;
    events: Array<{ id: string; type: string; payload: unknown; occurredAt: string }>;
  }> {
    const provider = this.provider(rawProvider);
    const row = await getIntegration(this.deps, this.tenant.workspaceId, provider);
    const deliveries = row
      ? await this.tenant.run((tx) =>
          tx.integrationDelivery.findMany({
            where: { integrationId: row.id },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        )
      : [];
    const events = await this.tenant.run((tx) =>
      tx.event.findMany({
        where: {
          type: { startsWith: "integration." },
          payload: { path: ["provider"], equals: provider },
        },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
    );
    return {
      deliveries: deliveries.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        detail: d.detail,
        createdAt: d.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }
}
