import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { contactCustomValuesSchema, importContactsSchema } from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import {
  checkMxDomains,
  domainOf,
  enqueueValidationBatch,
  normalizeEmail,
  syntaxValid,
  upsertValidationBatch,
  type ValidationJob,
} from "@clientforce/validation";
import type { Queue } from "bullmq";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { Role, type Prisma } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import {
  VALIDATION_LIGHT_DEPS,
  VALIDATION_QUEUE,
  type ValidationLightDeps,
} from "./validation.providers";

interface CreateContactDto {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  title?: string;
  custom?: unknown;
}

/**
 * Minimal tenant-scoped resource used to exercise tenancy + RBAC:
 *   - GET is readable by any member (rows scoped by RLS to the active workspace).
 *   - POST is a write restricted to OWNER/ADMIN/AGENT (VIEWER denied).
 * C2.7 adds `custom` values (validated against ACTIVE workspace defs, unknown
 * keys rejected) on create, and PATCH :id for the detail-drawer inline edit.
 */
@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Optional()
    @Inject(VALIDATION_QUEUE)
    private readonly validationQueue: Queue<ValidationJob> | null,
    @Optional()
    @Inject(VALIDATION_LIGHT_DEPS)
    private readonly lightDeps: ValidationLightDeps | null,
  ) {}

  /**
   * IMP-3 (owner bug round 2026-07-08): CSV import executes server-side — ONE
   * transactional call per chunk replaces the per-row request storm. Within-
   * batch dedupe (first occurrence wins) + workspace dedupe (case-insensitive
   * email), suppression flagging (suppressed rows still create — A7 blocks at
   * send time), C2.7 custom-value validation, C2.8 list attach. Per-row
   * failures are collected BEFORE any write: a mid-transaction create failure
   * would poison the Postgres tx, so everything that can fail is validated
   * up front and the write phase is all-or-nothing per chunk.
   */
  @Post("import")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async import(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = importContactsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const dto = parsed.data;
    const workspaceId = req.auth!.activeWorkspaceId;
    const addedBy = req.auth!.user.id;

    const result = await this.tenant.run(async (tx) => {
      // Within-batch dedupe — first occurrence wins, later repeats skip.
      const seen = new Set<string>();
      const batch: Array<{ index: number; email: string; row: (typeof dto.rows)[number] }> = [];
      let skippedDuplicates = 0;
      dto.rows.forEach((row, index) => {
        const email = row.email.trim().toLowerCase();
        if (seen.has(email)) {
          skippedDuplicates += 1;
          return;
        }
        seen.add(email);
        batch.push({ index, email, row });
      });

      // Workspace dedupe (case-insensitive) + suppression flags, one query each.
      const [existing, suppressions] = await Promise.all([
        tx.contact.findMany({
          where: {
            OR: batch.map((b) => ({ email: { equals: b.email, mode: "insensitive" as const } })),
          },
          select: { email: true },
        }),
        tx.suppression.findMany({ where: { channel: "email" }, select: { address: true } }),
      ]);
      const existingSet = new Set(existing.map((e) => (e.email ?? "").toLowerCase()));
      const suppressedSet = new Set(suppressions.map((s) => s.address.toLowerCase()));

      // C2.7 custom validation, batched: one defs fetch for the whole chunk.
      const allKeys = new Set<string>();
      for (const b of batch) for (const k of Object.keys(b.row.custom ?? {})) allKeys.add(k);
      const activeDefs =
        allKeys.size > 0
          ? await tx.contactFieldDef.findMany({
              where: { key: { in: [...allKeys] }, archived: false },
              select: { key: true },
            })
          : [];
      const knownKeys = new Set(activeDefs.map((d) => d.key));

      const failed: Array<{ index: number; email: string; reason: string }> = [];
      const creatable: typeof batch = [];
      for (const b of batch) {
        if (existingSet.has(b.email)) {
          skippedDuplicates += 1;
          continue;
        }
        const unknown = Object.keys(b.row.custom ?? {}).filter((k) => !knownKeys.has(k));
        if (unknown.length > 0) {
          failed.push({
            index: b.index,
            email: b.row.email,
            reason: `Unknown or archived custom field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
          });
          continue;
        }
        creatable.push(b);
      }

      let created = 0;
      let suppressed = 0;
      const createdIds: string[] = [];
      const createdContacts: Array<{ contactId: string; email: string }> = [];
      // B3c-1: provenance events only for EXPLICITLY imported consent —
      // defaulted "unknown" is a non-event, never timeline noise.
      const consentWrites: Array<{ contactId: string; value: string }> = [];
      for (const b of creatable) {
        const c = await tx.contact.create({
          data: {
            workspaceId,
            source: "csv_import",
            optOut: {},
            tags: [],
            email: b.row.email.trim(),
            firstName: b.row.firstName ?? null,
            lastName: b.row.lastName ?? null,
            company: b.row.company ?? null,
            phone: b.row.phone ?? null,
            title: b.row.title ?? null,
            // B3c-1 (DEC-118(2)): an explicit CSV call-consent value writes;
            // absent stays the "unknown" default (Ada may not call).
            ...(b.row.callConsent ? { callConsent: b.row.callConsent } : {}),
            ...(b.row.custom && Object.keys(b.row.custom).length > 0
              ? { custom: b.row.custom as Prisma.InputJsonValue }
              : {}),
          },
        });
        createdIds.push(c.id);
        createdContacts.push({ contactId: c.id, email: b.email });
        if (b.row.callConsent) {
          consentWrites.push({ contactId: c.id, value: b.row.callConsent });
        }
        created += 1;
        if (suppressedSet.has(b.email)) suppressed += 1;
      }

      // C2.8 list attach — archived lists never gain members.
      let list: { id: string; name: string; origin: string } | null = null;
      if (dto.listId && createdIds.length > 0) {
        const row = await tx.contactList.findUnique({ where: { id: dto.listId } });
        if (row && !row.archived) {
          await tx.contactListMember.createMany({
            data: createdIds.map((contactId) => ({
              workspaceId,
              listId: row.id,
              contactId,
              addedBy,
            })),
            skipDuplicates: true,
          });
          list = { id: row.id, name: row.name, origin: row.origin };
        }
      }
      return { created, skippedDuplicates, suppressed, failed, createdIds, createdContacts, consentWrites, list };
    });

    // LH1 (DEC-087): the ASYNC validation pass — never blocks the import.
    // Created rows land `unverified` and queue for validation; every chunk of
    // one import attaches to ONE batch via the client key. Without Redis the
    // batch row still lands and the worker's requeue sweep picks it up.
    let validationBatchId: string | undefined;
    if (result.createdContacts.length > 0) {
      const { batchId } = await upsertValidationBatch(this.prisma.app, {
        workspaceId,
        source: "csv_import",
        ...(dto.validationBatchKey ? { clientKey: dto.validationBatchKey } : {}),
        ...(dto.listId ? { listId: dto.listId } : {}),
        contacts: result.createdContacts,
      });
      validationBatchId = batchId;
      if (this.validationQueue) {
        await enqueueValidationBatch(this.validationQueue, { workspaceId, batchId });
      }
    }

    // B3c-1 (DEC-118(2)): consent provenance for explicitly imported values
    // — the LIST_MEMBER_ADDED pattern, how: "csv_import".
    for (const w of result.consentWrites) {
      await this.publisher.publish({
        type: "contact.call_consent.v1",
        workspaceId,
        contactId: w.contactId,
        payload: { value: w.value, byUserId: addedBy, how: "csv_import" },
      });
    }

    // Membership events publish after the transaction commits (C2.8 join points).
    if (result.list) {
      for (const contactId of result.createdIds) {
        await this.publisher.publish({
          type: EVENT_TYPES.LIST_MEMBER_ADDED,
          workspaceId,
          contactId,
          payload: {
            listId: result.list.id,
            listName: result.list.name,
            addedBy,
            origin: result.list.origin,
          },
        });
      }
    }
    return {
      created: result.created,
      skippedDuplicates: result.skippedDuplicates,
      suppressed: result.suppressed,
      failed: result.failed,
      ...(validationBatchId ? { validationBatchId } : {}),
    };
  }

  /** C2.8: `?listId=` scopes to explicit membership; rows carry active lists. */
  @Get()
  list(@Query("listId") listId?: string) {
    return this.tenant.run(async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        ...(listId ? { where: { lists: { some: { listId } } } } : {}),
        include: {
          lists: { select: { list: { select: { id: true, name: true, archived: true } } } },
        },
      });
      return contacts.map(({ lists, ...c }) => ({
        ...c,
        lists: lists
          .filter((m) => !m.list.archived)
          .map((m) => ({ id: m.list.id, name: m.list.name })),
      }));
    });
  }

  /**
   * LH1 (DEC-087): manual/form/widget adds get the LIGHT pass INLINE (cache →
   * suppression flag → syntax → MX) — fast, free, never blocking: light-pass
   * trouble degrades to `unverified`, and anything unresolved queues for the
   * full async provider verdict. Future ingress sources (form/widget) create
   * through this same seam and inherit the pass — no per-source forks.
   */
  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async create(@Req() req: AuthenticatedRequest, @Body() body: CreateContactDto) {
    const workspaceId = req.auth!.activeWorkspaceId;
    const email = body.email?.trim() ? body.email.trim() : null;
    const address = email ? normalizeEmail(email) : null;

    let verdict: { value: string; source: string } | null = null;
    let suppressed = false;
    if (address) {
      const [cached, suppression] = await this.tenant.run(async (tx) =>
        Promise.all([
          tx.emailValidationVerdict.findUnique({
            where: { workspaceId_address: { workspaceId, address } },
          }),
          tx.suppression.findFirst({ where: { channel: "email", address }, select: { id: true } }),
        ]),
      );
      suppressed = Boolean(suppression);
      if (cached && cached.expiresAt > new Date()) {
        verdict = { value: cached.verdict, source: "cache" };
      } else if (!syntaxValid(address)) {
        verdict = { value: "invalid", source: "syntax" };
      } else if (this.lightDeps?.resolveMx) {
        const domain = domainOf(address);
        if (domain) {
          const mx = await checkMxDomains([domain], this.lightDeps.resolveMx).catch(() => null);
          if (mx?.get(domain) === "none") verdict = { value: "invalid", source: "mx" };
        }
      }
    }

    const contact = await this.tenant.run(async (tx) => {
      const custom = await validateCustom(tx, body.custom);
      return tx.contact.create({
        data: {
          workspaceId,
          source: "manual",
          optOut: {},
          tags: [],
          email,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          company: body.company ?? null,
          phone: body.phone ?? null,
          title: body.title ?? null,
          ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}),
          ...(verdict
            ? {
                emailVerdict: verdict.value,
                emailVerdictCheckedAt: new Date(),
                emailVerdictSource: verdict.source,
              }
            : {}),
        },
      });
    });

    // Unresolved by the light pass → queue the real-time provider verdict
    // (suppressed rows never queue — the free-filter stance: never pay to
    // validate what can't be sent to anyway).
    if (address && !verdict && !suppressed) {
      const { batchId } = await upsertValidationBatch(this.prisma.app, {
        workspaceId,
        source: "single",
        contacts: [{ contactId: contact.id, email: address }],
      });
      if (this.validationQueue) {
        await enqueueValidationBatch(this.validationQueue, { workspaceId, batchId });
      }
    }
    return { ...contact, suppressed };
  }

  /** C2.7: custom-value edit (detail drawer). Values merge; defs never change
   *  here. B3a review (DEC-112(7), additive): `tags` (full replace) and
   *  `notes` (set/clear) ride the same PATCH. B3c-1 (DEC-118(2), additive):
   *  `callConsent` flips here too — every flip lands provenance on the
   *  timeline (`contact.call_consent.v1`, how: "manual"). */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { custom?: unknown; tags?: unknown; notes?: unknown; callConsent?: unknown },
  ) {
    return this.tenant.run(async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id } });
      if (!contact) throw new NotFoundException(`Contact ${id} not found`);
      const custom = await validateCustom(tx, body.custom);
      const tags = validateTags(body.tags);
      const notes = validateNotes(body.notes);
      const callConsent = validateCallConsent(body.callConsent);
      if (!custom && tags === undefined && notes === undefined && callConsent === undefined) {
        throw new BadRequestException("Provide custom values, tags, notes or call consent to update");
      }
      const merged = custom
        ? {
            ...(contact.custom && typeof contact.custom === "object" && !Array.isArray(contact.custom)
              ? (contact.custom as Record<string, unknown>)
              : {}),
            ...custom,
          }
        : undefined;
      const updated = await tx.contact.update({
        where: { id },
        data: {
          ...(merged ? { custom: merged as Prisma.InputJsonValue } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(callConsent !== undefined ? { callConsent } : {}),
        },
      });
      if (callConsent !== undefined && callConsent !== (contact as { callConsent?: string }).callConsent) {
        await tx.event.create({
          data: {
            workspaceId: this.tenant.workspaceId,
            type: "contact.call_consent.v1",
            contactId: id,
            payload: { value: callConsent, byUserId: req.auth!.user.id, how: "manual" },
          },
        });
      }
      return updated;
    });
  }
}

/** B3c-1: the ruled tri-state — granted | denied | unknown. */
function validateCallConsent(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "granted" && raw !== "denied" && raw !== "unknown") {
    throw new BadRequestException("callConsent must be granted, denied or unknown");
  }
  return raw;
}

/** B3a review: tags = full replace; trimmed, deduped, each 1–40 chars, max 20. */
function validateTags(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== "string")) {
    throw new BadRequestException("tags must be an array of strings");
  }
  const tags = [...new Set((raw as string[]).map((t) => t.trim()).filter(Boolean))];
  if (tags.length > 20 || tags.some((t) => t.length > 40)) {
    throw new BadRequestException("tags: max 20, each up to 40 characters");
  }
  return tags;
}

/** B3a review: notes — a single free-text field; null/empty clears it. */
function validateNotes(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new BadRequestException("notes must be a string");
  const trimmed = raw.trim();
  if (trimmed.length > 2000) throw new BadRequestException("notes: up to 2000 characters");
  return trimmed || null;
}

/** Validates `custom` against ACTIVE defs — unknown/archived keys reject (400). */
async function validateCustom(
  tx: Prisma.TransactionClient,
  raw: unknown,
): Promise<Record<string, string> | null> {
  if (raw === undefined || raw === null) return null;
  const parsed = contactCustomValuesSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException("custom must map field keys to string values");
  const keys = Object.keys(parsed.data);
  if (keys.length === 0) return null;
  const defs = await tx.contactFieldDef.findMany({
    where: { key: { in: keys }, archived: false },
    select: { key: true },
  });
  const known = new Set(defs.map((d) => d.key));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unknown or archived custom field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
    );
  }
  return parsed.data;
}
