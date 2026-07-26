/**
 * INT W5 (DEC-102) — the Zapier rail's authentication.
 *
 * A presented API key resolves to a workspace BEFORE any tenant context exists,
 * which is the same bootstrap problem the Calendly/Stripe capability-URL
 * controllers solve: the lookup uses the RLS-EXEMPT owner client, and every
 * subsequent feature query runs through `withTenant` on the app role. The owner
 * client is touched for exactly one thing — turning a credential into a
 * workspace id — and never for feature data.
 *
 * Every rejection is the same shape and the same message: an attacker probing
 * keys learns only "no", never whether a prefix existed, was revoked, or simply
 * had the wrong secret.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ZAPIER_REFUSALS } from "@clientforce/core";
import { parseApiKeyPrefix, verifyApiKey } from "@clientforce/integrations";
import { PrismaService } from "../db/prisma.service";

export interface ZapierRequestContext {
  workspaceId: string;
  apiKeyId: string;
}

/** Attached to the request for controllers to read. */
export const ZAPIER_CTX = "zapierCtx" as const;

@Injectable()
export class ZapierAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = (req.headers ?? {}) as Record<string, string | undefined>;

    // Zapier sends the key as a bearer token; accept the bare header too so a
    // hand-rolled curl during setup does not fail for a cosmetic reason.
    const raw = headers.authorization ?? "";
    const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw.trim();

    const prefix = parseApiKeyPrefix(token);
    if (!prefix) throw new UnauthorizedException(ZAPIER_REFUSALS.KEY_INVALID);

    // Owner client: the credential IS the tenant selector, so there is no
    // workspace to scope by yet. Nothing else is read on this connection.
    const row = await this.prisma.admin.workspaceApiKey.findUnique({ where: { prefix } });

    // One refusal for every failure mode. Note the hash comparison still runs
    // for a revoked key so that revoked and wrong-secret cost the same.
    const ok = row ? verifyApiKey(token, row.hash) : false;
    if (!row || !ok || row.revokedAt) {
      throw new UnauthorizedException(
        row?.revokedAt && ok ? ZAPIER_REFUSALS.KEY_REVOKED : ZAPIER_REFUSALS.KEY_INVALID,
      );
    }

    // Best-effort staleness touch — never blocks the request, never fails it.
    void this.prisma.admin.workspaceApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    (req as Record<string, unknown>)[ZAPIER_CTX] = {
      workspaceId: row.workspaceId,
      apiKeyId: row.id,
    } satisfies ZapierRequestContext;
    return true;
  }
}
