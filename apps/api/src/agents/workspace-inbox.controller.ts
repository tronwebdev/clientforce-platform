import { Controller, Get } from "@nestjs/common";
import { TenantClient } from "../db/tenant-client";
import { assembleInboxThreads } from "./inbox-threads";

/**
 * B3a (DEC-112): the workspace-wide inbox read — §4.5's "same component,
 * different scope". One additive endpoint: every campaign's threads through
 * the SAME `assembleInboxThreads` the campaign inbox uses, each thread
 * carrying its campaign attribution (a contact replying inside two campaigns
 * is two threads). Newest-activity first; read-only — every triage write
 * stays on the shipped endpoints (enrollment PATCH, message done PATCH,
 * list members). Tenant scoping rides RLS like every read here.
 */
@Controller("inbox")
export class WorkspaceInboxController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  async inbox() {
    return this.tenant.run(async (tx) => {
      const campaigns = await tx.campaign.findMany({
        orderBy: { createdAt: "asc" },
        include: { agent: { select: { name: true } } },
      });
      const threads = await assembleInboxThreads(
        tx,
        campaigns.map((c) => ({ id: c.id, name: c.name, agentId: c.agentId, agentName: c.agent.name })),
      );
      threads.sort((a, b) => (b?.lastAt ?? "").localeCompare(a?.lastAt ?? ""));
      return { threads };
    });
  }
}
