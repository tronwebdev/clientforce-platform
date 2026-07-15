import { Controller, Get, Header, NotFoundException, Param, Query } from "@nestjs/common";
import type {
  ValidationBatchReport,
  ValidationBatchRow,
  ValidationBatchStatus,
  ValidationHoldReason,
  ValidationItemOutcome,
} from "@clientforce/core";
import { TenantClient } from "../db/tenant-client";

/**
 * LH1 (DEC-087): the import report's data — progressive (verdicts land as
 * chunks return; `pending` powers the honest "Validating N contacts —
 * sending starts as they clear" line, `heldReason` the honest "validation
 * queued" states), with row-level detail and the exclusions CSV. Honest
 * about EVERY exclusion: nothing invalid lands enrollable, and the report
 * says exactly which rows and why.
 */
@Controller("contacts/validation-batches")
export class ContactValidationController {
  constructor(private readonly tenant: TenantClient) {}

  @Get(":id")
  async report(@Param("id") id: string): Promise<ValidationBatchReport> {
    return this.tenant.run(async (tx) => {
      const batch = await tx.validationBatch.findUnique({ where: { id } });
      if (!batch) throw new NotFoundException(`Validation batch ${id} not found`);
      const groups = await tx.validationBatchItem.groupBy({
        by: ["outcome"],
        where: { batchId: id },
        _count: { _all: true },
      });
      const count = (outcome: string): number =>
        groups.find((g) => g.outcome === outcome)?._count._all ?? 0;
      return {
        id: batch.id,
        status: batch.status as ValidationBatchStatus,
        heldReason: (batch.heldReason as ValidationHoldReason | null) ?? null,
        source: batch.source,
        listId: batch.listId,
        counts: {
          total: groups.reduce((n, g) => n + g._count._all, 0),
          pending: count("pending"),
          valid: count("valid"),
          risky: count("risky"),
          invalid: count("invalid"),
          skippedSuppressed: count("skipped_suppressed"),
        },
        createdAt: batch.createdAt.toISOString(),
        completedAt: batch.completedAt?.toISOString() ?? null,
      };
    });
  }

  /** Row-level detail, filterable by outcome (the report table). */
  @Get(":id/rows")
  async rows(
    @Param("id") id: string,
    @Query("outcome") outcome?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ): Promise<{ rows: ValidationBatchRow[] }> {
    const takeN = Math.min(Math.max(Number(take) || 100, 1), 500);
    const skipN = Math.max(Number(skip) || 0, 0);
    return this.tenant.run(async (tx) => {
      const batch = await tx.validationBatch.findUnique({ where: { id }, select: { id: true } });
      if (!batch) throw new NotFoundException(`Validation batch ${id} not found`);
      const items = await tx.validationBatchItem.findMany({
        where: { batchId: id, ...(outcome ? { outcome } : {}) },
        orderBy: { id: "asc" },
        take: takeN,
        skip: skipN,
      });
      return {
        rows: items.map((i) => ({
          contactId: i.contactId,
          email: i.address,
          outcome: i.outcome as ValidationItemOutcome,
          via: i.via,
          detail: i.detail,
        })),
      };
    });
  }

  /** The exclusion download: every row the import will not send to, with why. */
  @Get(":id/exclusions.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="import-exclusions.csv"')
  async exclusionsCsv(@Param("id") id: string): Promise<string> {
    return this.tenant.run(async (tx) => {
      const batch = await tx.validationBatch.findUnique({ where: { id }, select: { id: true } });
      if (!batch) throw new NotFoundException(`Validation batch ${id} not found`);
      const items = await tx.validationBatchItem.findMany({
        where: { batchId: id, outcome: { in: ["invalid", "skipped_suppressed"] } },
        orderBy: { id: "asc" },
      });
      const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = items.map((i) =>
        [
          esc(i.address),
          i.outcome === "skipped_suppressed" ? "already suppressed" : "invalid",
          esc(i.detail ?? i.via ?? ""),
        ].join(","),
      );
      return ["email,excluded_because,detail", ...lines].join("\n");
    });
  }
}
