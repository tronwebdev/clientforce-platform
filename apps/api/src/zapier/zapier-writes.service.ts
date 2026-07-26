/**
 * INT W5 (DEC-101) — the inbound writes a Zap performs.
 *
 * These CREATE or ROUTE records, which is why they are their own registry
 * rather than rule actions (owner ruling): a rule fires on a contact that
 * already exists, whereas these bring it into being. The dispatch is a
 * non-Partial Record over the write kinds, so a new kind cannot be added
 * without a handler — the same compile-time discipline the action exposure map
 * uses.
 *
 * Everything runs through `withTenant` on the RLS-subject role, and enrolment
 * goes through the REAL enrolment path so suppression, opt-out and the LH1
 * email-verdict gate all still apply. Zapier gets no side door.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { withTenant, type Prisma } from "@clientforce/db";
import { ZAPIER_REFUSALS, type ZapierInboundWriteKind } from "@clientforce/core";
import { PrismaService } from "../db/prisma.service";

type Tx = Prisma.TransactionClient;
type Identity = { email?: string; phone?: string };
type ContactFields = Identity & {
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  tags?: string[];
  custom?: Record<string, string>;
};

/** Match on email first, then phone — the same precedence the ingest paths use. */
const identityWhere = (workspaceId: string, id: Identity) =>
  id.email
    ? { workspaceId, email: id.email }
    : { workspaceId, phone: id.phone! };

@Injectable()
export class ZapierWritesService {
  constructor(private readonly prisma: PrismaService) {}

  async perform(workspaceId: string, kind: ZapierInboundWriteKind, payload: unknown) {
    // NON-PARTIAL: a new write kind fails to compile until it has a handler.
    const handlers: Record<ZapierInboundWriteKind, () => Promise<unknown>> = {
      create_contact: () => this.createContact(workspaceId, payload as ContactFields),
      update_contact: () => this.updateContact(workspaceId, payload as ContactFields),
      enroll_in_campaign: () =>
        this.enroll(workspaceId, payload as Identity & { campaignId: string }),
    };
    return handlers[kind]();
  }

  private async createContact(workspaceId: string, input: ContactFields) {
    return withTenant(this.prisma.app, { workspaceId }, async (tx) => {
      const existing = await tx.contact.findFirst({ where: identityWhere(workspaceId, input) });
      // Refuse rather than silently upsert: a Zap that "created" a contact and
      // quietly overwrote a real one is a data-loss bug the user cannot see.
      if (existing) throw new BadRequestException(ZAPIER_REFUSALS.CONTACT_EXISTS);
      const contact = await tx.contact.create({
        data: {
          workspaceId,
          source: "zapier",
          optOut: {},
          tags: input.tags ?? [],
          custom: (input.custom ?? {}) as Prisma.InputJsonValue,
          ...this.scalars(input),
        },
      });
      return this.view(contact);
    });
  }

  private async updateContact(workspaceId: string, input: ContactFields) {
    return withTenant(this.prisma.app, { workspaceId }, async (tx) => {
      const existing = await tx.contact.findFirst({ where: identityWhere(workspaceId, input) });
      if (!existing) throw new NotFoundException(ZAPIER_REFUSALS.CONTACT_NOT_FOUND);
      const contact = await tx.contact.update({
        where: { id: existing.id },
        data: {
          ...this.scalars(input),
          // Tags are a SET — a Zap adding a tag must not drop the others.
          ...(input.tags ? { tags: [...new Set([...existing.tags, ...input.tags])] } : {}),
          ...(input.custom
            ? {
                custom: {
                  ...((existing.custom as Record<string, unknown>) ?? {}),
                  ...input.custom,
                } as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
      return this.view(contact);
    });
  }

  private async enroll(workspaceId: string, input: Identity & { campaignId: string }) {
    return withTenant(this.prisma.app, { workspaceId }, async (tx) => {
      const contact = await tx.contact.findFirst({ where: identityWhere(workspaceId, input) });
      if (!contact) throw new NotFoundException(ZAPIER_REFUSALS.CONTACT_NOT_FOUND);
      const campaign = await tx.campaign.findFirst({
        where: { workspaceId, id: input.campaignId },
        select: { id: true },
      });
      if (!campaign) throw new NotFoundException(ZAPIER_REFUSALS.CAMPAIGN_NOT_FOUND);

      // Idempotent by construction: re-running the same Zap returns the
      // existing enrolment instead of stacking duplicates on the contact.
      const existing = await tx.enrollment.findFirst({
        where: { workspaceId, campaignId: campaign.id, contactId: contact.id },
        select: { id: true, pipelineStage: true },
      });
      if (existing) {
        return { enrollmentId: existing.id, contactId: contact.id, created: false };
      }
      const enrollment = await this.createEnrollment(tx, workspaceId, campaign.id, contact.id);
      return { enrollmentId: enrollment.id, contactId: contact.id, created: true };
    });
  }

  private createEnrollment(tx: Tx, workspaceId: string, campaignId: string, contactId: string) {
    return tx.enrollment.create({
      data: {
        workspaceId,
        campaignId,
        contactId,
        workflowId: `zapier-${contactId}-${campaignId}`,
        pipelineStage: "new",
        meta: { source: "zapier" },
      },
      select: { id: true },
    });
  }

  private scalars(input: ContactFields) {
    return {
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.company ? { company: input.company } : {}),
      ...(input.title ? { title: input.title } : {}),
    };
  }

  private view(c: { id: string; email: string | null; phone: string | null; tags: string[] }) {
    return { contactId: c.id, email: c.email, phone: c.phone, tags: c.tags };
  }
}
