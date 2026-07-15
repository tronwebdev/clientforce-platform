import { Controller, Get } from "@nestjs/common";
import { TenantClient } from "../db/tenant-client";

/**
 * P5 W3 (DEC-085): the pipeline board's column source — the EXISTING
 * `PipelineStage` rows (workspace defaults seeded at T1; campaign overrides
 * when they exist), ordered. Read-only: stage CRUD is not this unit.
 */
@Controller("pipeline-stages")
export class PipelineStagesController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  list() {
    return this.tenant.run((tx) =>
      tx.pipelineStage.findMany({
        where: { campaignId: null },
        orderBy: { order: "asc" },
        select: { id: true, key: true, label: true, order: true },
      }),
    );
  }
}
