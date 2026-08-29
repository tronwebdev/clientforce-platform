/**
 * B5 (DEC-130): the FIRST code over the Form/FormSubmission tables — tenant
 * CRUD for the Bold Forms surface. The publicId is minted at first publish
 * and is the only identifier that ever leaves the platform (the widget's
 * `wgt_` stance). Everything here is additive; the public submit rail lives
 * in FormsPublicController.
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
import { randomBytes } from "node:crypto";
import { formPatchSchema, formWriteSchema, type FormField } from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/** Resolve the write-side agentId hint to the stored campaignId (the
 *  browser-calls precedent: the console names an agent, the server finds
 *  its campaign; agentId itself is never stored). */
async function resolveRouting(
  tx: { campaign: { findFirst: (a: object) => Promise<{ id: string } | null> } },
  routing: { campaignId?: string | null; agentId?: string; tag?: string; redirectUrl?: string },
): Promise<Record<string, unknown>> {
  const { agentId, ...rest } = routing;
  if (agentId && !rest.campaignId) {
    const campaign = await tx.campaign.findFirst({
      where: { agentId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (campaign) rest.campaignId = campaign.id;
  }
  return rest;
}

const designOf = (d: { intro?: string; submitLabel?: string; kind?: string }) => ({
  ...(d.intro !== undefined ? { intro: d.intro } : {}),
  ...(d.submitLabel !== undefined ? { submitLabel: d.submitLabel } : {}),
  ...(d.kind !== undefined ? { kind: d.kind } : {}),
});

const row = (f: {
  id: string;
  title: string;
  status: string;
  publicId: string | null;
  fields: unknown;
  design: unknown;
  routing: unknown;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: f.id,
  title: f.title,
  status: f.status,
  publicId: f.publicId,
  fields: (f.fields ?? []) as FormField[],
  design: (f.design ?? {}) as Record<string, unknown>,
  routing: (f.routing ?? {}) as Record<string, unknown>,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});

@Controller("forms")
export class FormsController {
  constructor(private readonly tenant: TenantClient) {}

  /** The list the grid + the LIVE eyebrow read: rows with REAL counts. */
  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list() {
    return this.tenant.run(async (tx) => {
      const forms = await tx.form.findMany({ orderBy: { createdAt: "asc" } });
      const counts = await tx.formSubmission.groupBy({
        by: ["formId"],
        _count: { _all: true },
      });
      const byForm = new Map(counts.map((c) => [c.formId, c._count._all]));
      return {
        forms: forms.map((f) => ({ ...row(f), responses: byForm.get(f.id) ?? 0 })),
      };
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const parsed = formWriteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid form",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const d = parsed.data;
    return this.tenant.run(async (tx) => {
      const created = await tx.form.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          title: d.title,
          fields: d.fields as unknown as Prisma.InputJsonValue,
          design: designOf(d) as Prisma.InputJsonValue,
          routing: (await resolveRouting(tx, d.routing ?? {})) as Prisma.InputJsonValue,
        },
      });
      return row(created);
    });
  }

  /** Detail + the latest responses (with the contact door the rows open). */
  @Get(":id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async detail(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const form = await tx.form.findUnique({ where: { id } });
      if (!form) throw new NotFoundException(`Form ${id} not found`);
      const submissions = await tx.formSubmission.findMany({
        where: { formId: id },
        orderBy: { submittedAt: "desc" },
        take: 50,
      });
      const contactIds = submissions.map((s) => s.contactId).filter((c): c is string => !!c);
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const responses = await tx.formSubmission.count({ where: { formId: id } });
      return {
        form: row(form),
        responses,
        submissions: submissions.map((s) => {
          const c = s.contactId ? byId.get(s.contactId) : undefined;
          return {
            id: s.id,
            contactId: s.contactId,
            contactName: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || null : null,
            answers: (s.answers ?? {}) as Record<string, string>,
            submittedAt: s.submittedAt.toISOString(),
          };
        }),
      };
    });
  }

  /** Edit + publish. Flipping to "live" mints the public credential once. */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async patch(@Param("id") id: string, @Body() body: unknown) {
    const parsed = formPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid form patch",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const d = parsed.data;
    return this.tenant.run(async (tx) => {
      const form = await tx.form.findUnique({ where: { id } });
      if (!form) throw new NotFoundException(`Form ${id} not found`);
      const design = { ...((form.design ?? {}) as Record<string, unknown>), ...designOf(d) };
      const routing = d.routing
        ? {
            ...((form.routing ?? {}) as Record<string, unknown>),
            ...(await resolveRouting(tx, d.routing)),
          }
        : undefined;
      const updated = await tx.form.update({
        where: { id },
        data: {
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.fields !== undefined
            ? { fields: d.fields as unknown as Prisma.InputJsonValue }
            : {}),
          design: design as Prisma.InputJsonValue,
          ...(routing ? { routing: routing as Prisma.InputJsonValue } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.status === "live" && !form.publicId
            ? { publicId: `frm_${randomBytes(12).toString("hex")}` }
            : {}),
        },
      });
      return row(updated);
    });
  }
}
