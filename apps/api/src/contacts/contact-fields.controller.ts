import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  createContactFieldSchema,
  MAX_ACTIVE_FIELD_DEFS,
  slugifyFieldLabel,
  updateContactFieldSchema,
  type ContactFieldDefDto,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * Workspace custom-field definitions (C2.7, docs/PLAN_CUSTOM_FIELDS.md).
 * Creation + management are ADMIN-only (owner decision 2); keys are immutable
 * slugs; defs archive, never delete — values stay in Contact.custom.
 */
@Controller("contact-fields")
export class ContactFieldsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  async list(): Promise<ContactFieldDefDto[]> {
    return this.tenant.run(async (tx) => {
      const defs = await tx.contactFieldDef.findMany({ orderBy: { createdAt: "asc" } });
      return defs.map(toDto);
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown): Promise<ContactFieldDefDto> {
    const parsed = createContactFieldSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const key = slugifyFieldLabel(parsed.data.label);
    if (!key) throw new BadRequestException("Field label must contain letters or numbers");
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const existing = await tx.contactFieldDef.findUnique({
        where: { workspaceId_key: { workspaceId, key } },
      });
      if (existing) {
        throw new ConflictException(
          existing.archived
            ? `A field "${existing.label}" already exists but is archived — restore it instead of creating a duplicate.`
            : `A field "${existing.label}" already exists.`,
        );
      }
      const active = await tx.contactFieldDef.count({ where: { archived: false } });
      if (active >= MAX_ACTIVE_FIELD_DEFS) {
        throw new UnprocessableEntityException(
          `This workspace already has ${MAX_ACTIVE_FIELD_DEFS} active custom fields — archive one before adding another.`,
        );
      }
      const def = await tx.contactFieldDef.create({
        data: {
          workspaceId,
          key,
          label: parsed.data.label,
          type: parsed.data.type ?? "TEXT",
          options: [],
          origin: parsed.data.origin ?? "manual",
        },
      });
      return toDto(def);
    });
  }

  /** label / options / archived only — key + type are immutable (schema-enforced). */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Param("id") id: string, @Body() body: unknown): Promise<ContactFieldDefDto> {
    const parsed = updateContactFieldSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.tenant.run(async (tx) => {
      const def = await tx.contactFieldDef.findUnique({ where: { id } });
      if (!def) throw new NotFoundException(`Custom field ${id} not found`);
      const updated = await tx.contactFieldDef.update({ where: { id }, data: parsed.data });
      return toDto(updated);
    });
  }
}

const toDto = (d: {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
  origin: string;
  archived: boolean;
}): ContactFieldDefDto => ({
  id: d.id,
  key: d.key,
  label: d.label,
  type: d.type,
  options: d.options,
  origin: d.origin,
  archived: d.archived,
});
