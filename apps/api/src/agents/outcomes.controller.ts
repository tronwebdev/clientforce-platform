import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { loadCampaignOutcomes } from "@clientforce/planner";
import { TenantClient } from "../db/tenant-client";

/**
 * F1 (DEC-068) — per-step outcomes rollup, tenant-scoped through RLS.
 * Statistical honesty lives in the PAYLOAD: below the min-n floor a step's
 * rates are null and its signal is "none" (constants in @clientforce/core).
 * The same loader feeds the planner's outcome-aware regen block, so the UI
 * badges, the endpoint, and the regen prompt all cite one set of numbers.
 */
@Controller("agents")
export class OutcomesController {
  constructor(private readonly tenant: TenantClient) {}

  @Get(":id/outcomes")
  async outcomes(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      return loadCampaignOutcomes(tx, id);
    });
  }
}
