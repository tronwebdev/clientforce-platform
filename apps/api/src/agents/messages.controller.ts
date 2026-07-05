import { Body, Controller, NotFoundException, Param, Patch } from "@nestjs/common";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * Inbox mark-done (C2.4): persists `meta.done` on an INBOUND Message — the
 * thread state the prototype's mark-done control drives. Reversible.
 */
@Controller("messages")
export class MessagesController {
  constructor(private readonly tenant: TenantClient) {}

  @Patch(":id/done")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async setDone(@Param("id") id: string, @Body() body: { done?: boolean }) {
    return this.tenant.run(async (tx) => {
      const message = await tx.message.findUnique({ where: { id } });
      if (!message) throw new NotFoundException(`Message ${id} not found`);
      const meta = { ...((message.meta ?? {}) as object), done: body?.done !== false };
      return tx.message.update({ where: { id }, data: { meta } });
    });
  }
}
