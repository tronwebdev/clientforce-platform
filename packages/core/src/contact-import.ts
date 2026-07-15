import { z } from "zod";
import { contactCustomValuesSchema } from "./contact-fields";

/**
 * IMP-3 (owner bug round, 2026-07-08): CSV import executes SERVER-SIDE as one
 * transactional bulk call per chunk — within-batch + workspace dedupe,
 * suppression flagging, list attach, custom values — instead of a per-row
 * request storm. Also the seam the wizard's CSV flow reuses later (W3-1).
 */
export const IMPORT_CHUNK_MAX = 200;

export const importContactRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  /** Values for ACTIVE ContactFieldDef keys (validated server-side, C2.7). */
  custom: contactCustomValuesSchema.optional(),
});
export type ImportContactRow = z.infer<typeof importContactRowSchema>;

export const importContactsSchema = z.object({
  rows: z.array(importContactRowSchema).min(1).max(IMPORT_CHUNK_MAX),
  /** C2.8: attach every created contact to this list (step-3 select). */
  listId: z.string().optional(),
  /**
   * LH1 (DEC-087): client idempotency key for the ASYNC validation pass —
   * every chunk of one import lands on ONE ValidationBatch, so the report
   * has one home. Absent (older callers): each chunk still validates on its
   * own batch — no ingress skips the pipeline.
   */
  validationBatchKey: z.string().min(8).max(64).optional(),
});
export type ImportContactsInput = z.infer<typeof importContactsSchema>;

export interface ImportContactsResult {
  /** Contacts created (suppressed ones still create — A7 blocks at send time). */
  created: number;
  /** Skipped: email already in the workspace OR earlier in this same batch. */
  skippedDuplicates: number;
  /** Created but flagged: the email sits on the suppression list. */
  suppressed: number;
  failed: Array<{ index: number; email: string; reason: string }>;
  /** LH1 (DEC-087): the async validation batch covering this chunk's created
   *  rows (poll `GET /contacts/validation-batches/:id` for the report). */
  validationBatchId?: string;
}
