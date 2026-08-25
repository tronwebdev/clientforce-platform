import { Controller, Get } from "@nestjs/common";
import type { WorkspaceFlagsResponse } from "@clientforce/core";
import { TenantClient } from "../db/tenant-client";

/**
 * Tenant-side feature-flag read (B0, Console Bold port — additive).
 *
 * `FeatureFlag` is backoffice-WRITTEN (B1 W4, DEC-082: only the
 * `clientforce_backoffice` role mutates it) and app-READABLE — the W4
 * migration kept SELECT for `clientforce_app` exactly so the app can gate
 * features. The table carries no RLS policy, so the workspace scope here is
 * the explicit `workspaceId` filter from the resolved auth context; the query
 * still runs on the RLS-subject app client, never the owner client.
 */
@Controller("flags")
export class FlagsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  async flags(): Promise<WorkspaceFlagsResponse> {
    const workspaceId = this.tenant.workspaceId;
    const rows = await this.tenant.run((tx) =>
      tx.featureFlag.findMany({
        where: { workspaceId, enabled: true },
        select: { key: true },
        orderBy: { key: "asc" },
      }),
    );
    return { flags: rows.map((r) => r.key) };
  }
}
