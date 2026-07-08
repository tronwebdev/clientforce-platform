import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * Contacts screen surface (C2.5, checkpoints §5). The A10 segment chips are
 * QUERIES over these derived fields — never stored stage values:
 *   All = everything · New = stage `new` · Replied = any email.replied.v1 ·
 *   Qualified = stage ∈ {interested} · Booked = stage `booked` ·
 *   Unsub = optOut.email OR any Suppression row OR enrollment UNSUBSCRIBED.
 */
@Controller("contacts")
export class ContactsViewController {
  constructor(private readonly tenant: TenantClient) {}

  /**
   * Enriched rows the segment queries run over (workspace-scoped via RLS).
   * C2.8: `?listId=` scopes to explicit list membership (the rail IS the list
   * filter); each row carries `lists: [{id, name}]` (active lists only — an
   * archived list leaves every surface, membership preserved in the DB).
   */
  @Get("view")
  async view(@Query("listId") listId?: string) {
    return this.tenant.run(async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        ...(listId ? { where: { lists: { some: { listId } } } } : {}),
      });
      const ids = contacts.map((c) => c.id);
      const memberships = await tx.contactListMember.findMany({
        where: { contactId: { in: ids } },
        orderBy: { addedAt: "asc" },
        select: { contactId: true, list: { select: { id: true, name: true, archived: true } } },
      });
      const listsBy = new Map<string, { id: string; name: string }[]>();
      for (const m of memberships) {
        if (m.list.archived) continue;
        const arr = listsBy.get(m.contactId) ?? [];
        arr.push({ id: m.list.id, name: m.list.name });
        listsBy.set(m.contactId, arr);
      }
      const [enrollments, replied, suppressions, lastEvents] = await Promise.all([
        tx.enrollment.findMany({
          where: { contactId: { in: ids } },
          orderBy: { updatedAt: "desc" },
          select: {
            contactId: true,
            pipelineStage: true,
            status: true,
            updatedAt: true,
            campaignId: true,
            campaign: { select: { agent: { select: { name: true } } } },
          },
        }),
        tx.event.groupBy({
          by: ["contactId"],
          where: { contactId: { in: ids }, type: "email.replied.v1" },
          _count: { _all: true },
        }),
        tx.suppression.findMany({ where: { channel: "email" }, select: { address: true } }),
        tx.event.groupBy({
          by: ["contactId"],
          where: { contactId: { in: ids } },
          _max: { occurredAt: true },
        }),
      ]);

      const latestEnrollment = new Map<
        string,
        { pipelineStage: string; status: string; campaign?: { agent: { name: string } | null } | null }
      >();
      for (const e of enrollments) {
        if (e.contactId && !latestEnrollment.has(e.contactId)) latestEnrollment.set(e.contactId, e);
      }
      const repliedSet = new Set(replied.map((r) => r.contactId));
      const suppressed = new Set(suppressions.map((s) => s.address.toLowerCase()));
      const lastBy = new Map(lastEvents.map((e) => [e.contactId, e._max.occurredAt]));

      return contacts.map((c) => {
        const enr = latestEnrollment.get(c.id);
        const optOut = (c.optOut ?? {}) as { email?: boolean };
        const unsub =
          optOut.email === true ||
          (c.email ? suppressed.has(c.email.toLowerCase()) : false) ||
          enrollments.some((e) => e.contactId === c.id && e.status === "UNSUBSCRIBED");
        return {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          company: c.company,
          title: c.title,
          phone: c.phone,
          source: c.source,
          custom: c.custom ?? {},
          lists: listsBy.get(c.id) ?? [],
          createdAt: c.createdAt.toISOString(),
          stage: enr?.pipelineStage ?? null,
          agentName: enr?.campaign?.agent?.name ?? null,
          enrollmentStatus: enr?.status ?? null,
          replied: repliedSet.has(c.id),
          unsub,
          lastActivity: (lastBy.get(c.id) ?? c.createdAt)?.toISOString() ?? null,
        };
      });
    });
  }

  /** Drawer timeline: every Event row for the contact, cross-campaign, newest first. */
  @Get(":id/timeline")
  async timeline(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const rows = await tx.event.findMany({
        where: { contactId: id },
        orderBy: { occurredAt: "desc" },
        take: 100,
      });
      return {
        events: rows.map((e) => ({
          id: e.id,
          type: e.type,
          payload: e.payload,
          occurredAt: e.occurredAt.toISOString(),
        })),
      };
    });
  }

  /** Drawer "Move to" — stage move on the contact's latest enrollment. */
  @Post(":id/move")
  @Roles(Role.OWNER, Role.ADMIN)
  async move(@Param("id") id: string, @Body() body: { stage?: string }) {
    const stage = String(body?.stage ?? "").trim();
    if (!stage || stage.length > 40) throw new BadRequestException("stage required");
    return this.tenant.run(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { contactId: id },
        orderBy: { updatedAt: "desc" },
      });
      if (!enrollment) throw new BadRequestException("Contact has no enrollment to move");
      if (enrollment.pipelineStage === stage) return enrollment;
      const updated = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { pipelineStage: stage },
      });
      await tx.event.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          type: "lead.stage_changed.v1",
          contactId: id,
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
          payload: { fromStage: enrollment.pipelineStage, toStage: stage, manual: true },
        },
      });
      return updated;
    });
  }

  /**
   * Bulk unsubscribe (§5 interaction script): per contact set `optOut.email`,
   * write the Suppression row, flip ACTIVE enrollments to UNSUBSCRIBED and
   * persist `lead.unsubscribed.v1` — the row pill flips on the next poll.
   */
  @Post("unsubscribe")
  @Roles(Role.OWNER, Role.ADMIN)
  async unsubscribe(@Body() body: { contactIds?: string[] }) {
    const contactIds = Array.isArray(body?.contactIds) ? body.contactIds.filter(Boolean) : [];
    if (contactIds.length === 0 || contactIds.length > 200) {
      throw new BadRequestException("contactIds required (1–200)");
    }
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      let updated = 0;
      for (const id of contactIds) {
        const contact = await tx.contact.findUnique({ where: { id } });
        if (!contact) continue;
        const optOut = { ...((contact.optOut ?? {}) as object), email: true };
        await tx.contact.update({ where: { id }, data: { optOut } });
        if (contact.email) {
          await tx.suppression.upsert({
            where: {
              workspaceId_channel_address: { workspaceId, channel: "email", address: contact.email },
            },
            create: { workspaceId, channel: "email", address: contact.email, reason: "MANUAL", source: "contacts-bulk" },
            update: {},
          });
        }
        const enrollments = await tx.enrollment.findMany({
          where: { contactId: id, status: { in: ["ACTIVE", "PAUSED"] } },
        });
        for (const e of enrollments) {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: "UNSUBSCRIBED" } });
          await tx.event.create({
            data: {
              workspaceId,
              type: "lead.unsubscribed.v1",
              contactId: id,
              enrollmentId: e.id,
              campaignId: e.campaignId,
              payload: { source: "contacts-bulk" },
            },
          });
        }
        if (enrollments.length === 0) {
          await tx.event.create({
            data: { workspaceId, type: "lead.unsubscribed.v1", contactId: id, payload: { source: "contacts-bulk" } },
          });
        }
        updated += 1;
      }
      return { updated };
    });
  }
}
