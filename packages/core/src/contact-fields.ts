/**
 * Contact custom fields (C2.7, docs/PLAN_CUSTOM_FIELDS.md) — REST DTOs shared
 * by api + web, plus the {{custom.<key>|fallback}} token grammar shared with
 * the send renderer. Field creation is ADMIN-only; keys are immutable slugs;
 * defs archive, never delete.
 */
import { z } from "zod";

export const fieldTypeSchema = z.enum(["TEXT", "NUMBER", "DATE", "SELECT"]);
export type ContactFieldType = z.infer<typeof fieldTypeSchema>;

/** Server-enforced cap on ACTIVE (non-archived) defs per workspace. */
export const MAX_ACTIVE_FIELD_DEFS = 30;

/** "Source URL " → "source_url" — the immutable def key. */
export function slugifyFieldLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export const createContactFieldSchema = z.object({
  label: z.string().trim().min(1).max(60),
  /** v1 creation surfaces are TEXT-only; the model supports all four. */
  type: fieldTypeSchema.optional(),
  origin: z.enum(["manual", "csv_import"]).optional(),
});
export type CreateContactFieldInput = z.infer<typeof createContactFieldSchema>;

/** key + type are immutable after creation — .strict() rejects them outright. */
export const updateContactFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    options: z.array(z.string().min(1).max(120)).max(50).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.options !== undefined || v.archived !== undefined, {
    message: "Provide label, options and/or archived",
  });
export type UpdateContactFieldInput = z.infer<typeof updateContactFieldSchema>;

export interface ContactFieldDefDto {
  id: string;
  key: string;
  label: string;
  type: ContactFieldType;
  options: string[];
  origin: string;
  archived: boolean;
}

/** Contact create/update `custom` payload — values keyed by def key. */
export const contactCustomValuesSchema = z.record(z.string(), z.string().max(500));
export type ContactCustomValues = z.infer<typeof contactCustomValuesSchema>;

// ── {{custom.<key>|fallback}} token grammar ────────────────────────────────
// The fallback travels inside the token so the renderer needs no external
// lookup. A custom token WITHOUT a fallback is invalid at save time and a
// hard MissingTokenError at the send boundary — custom tokens never render
// blank (P1.5 rule).

export const CUSTOM_TOKEN_RE = /\{\{\s*custom\.([a-z0-9_]+)(?:\|([^}]*))?\s*\}\}/g;

export interface CustomTokenRef {
  key: string;
  /** undefined = no fallback present (save-time validation error). */
  fallback: string | undefined;
}

export function parseCustomTokens(text: string): CustomTokenRef[] {
  const out: CustomTokenRef[] = [];
  for (const m of text.matchAll(CUSTOM_TOKEN_RE)) {
    const fallback = m[2]?.trim();
    out.push({ key: m[1]!, fallback: fallback === undefined || fallback === "" ? undefined : fallback });
  }
  return out;
}

/** Keys of custom tokens missing their mandatory fallback (empty = valid). */
export function customTokensMissingFallback(text: string): string[] {
  return parseCustomTokens(text)
    .filter((t) => t.fallback === undefined)
    .map((t) => t.key);
}
