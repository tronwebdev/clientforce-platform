/**
 * B5 (DEC-130): the FIRST code over the Proposal table — DRAFT documents
 * only. Create, edit blocks, read back; `status` is server-owned and stays
 * "draft" (the delivery half — send, tracked links, viewed/accepted/paid,
 * the deposit link — is Q-100's spine; until it lands no proposal.* event
 * has a writer and nothing here pretends otherwise).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { proposalPatchSchema, proposalWriteSchema, type ProposalBlock } from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

const row = (p: {
  id: string;
  title: string;
  status: string;
  blocks: unknown;
  variables: unknown;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: p.id,
  title: p.title,
  status: p.status,
  blocks: (p.blocks ?? []) as ProposalBlock[],
  contactId: ((p.variables ?? {}) as { contactId?: string | null }).contactId ?? null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

@Controller("proposals")
export class ProposalsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list() {
    return this.tenant.run(async (tx) => {
      const proposals = await tx.proposal.findMany({ orderBy: { createdAt: "desc" } });
      const contactIds = proposals
        .map((p) => ((p.variables ?? {}) as { contactId?: string }).contactId)
        .filter((c): c is string => !!c);
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return {
        proposals: proposals.map((p) => {
          const r = row(p);
          const c = r.contactId ? byId.get(r.contactId) : undefined;
          return {
            ...r,
            contactName: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || null : null,
          };
        }),
      };
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const parsed = proposalWriteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid proposal",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const d = parsed.data;
    return this.tenant.run(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          title: d.title,
          blocks: d.blocks as unknown as Prisma.InputJsonValue,
          variables: (d.contactId ? { contactId: d.contactId } : {}) as Prisma.InputJsonValue,
        },
      });
      return row(created);
    });
  }

  @Get(":id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async detail(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p) throw new NotFoundException(`Proposal ${id} not found`);
      const r = row(p);
      const contact = r.contactId
        ? await tx.contact.findUnique({
            where: { id: r.contactId },
            select: { id: true, firstName: true, lastName: true },
          })
        : null;
      return {
        proposal: r,
        contactName: contact
          ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null
          : null,
      };
    });
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async patch(@Param("id") id: string, @Body() body: unknown) {
    const parsed = proposalPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid proposal patch",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const d = parsed.data;
    return this.tenant.run(async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p) throw new NotFoundException(`Proposal ${id} not found`);
      const variables = (p.variables ?? {}) as Record<string, unknown>;
      const updated = await tx.proposal.update({
        where: { id },
        data: {
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.blocks !== undefined
            ? { blocks: d.blocks as unknown as Prisma.InputJsonValue }
            : {}),
          ...(d.contactId !== undefined
            ? { variables: { ...variables, contactId: d.contactId } as Prisma.InputJsonValue }
            : {}),
        },
      });
      return row(updated);
    });
  }
}
