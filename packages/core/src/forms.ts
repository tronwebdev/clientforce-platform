import { z } from "zod";

/**
 * B5 (DEC-130): the FORM contract — the first code over the Form /
 * FormSubmission tables (present since init, unused until now). The shape
 * mirrors the widget contract's stance: the SERVER owns the spec, a public
 * submit is validated against the stored form (never the client's claim of
 * it), and the tenant's console edits ride the same zod the boundary
 * enforces.
 */
export const FORM_FIELD_TYPES = ["text", "phone", "email", "choice", "longtext"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const formFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "field keys are identifier-shaped"),
  label: z.string().min(1).max(120),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  /** Only for `choice`. */
  options: z.array(z.string().min(1).max(80)).max(12).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

/** Where a submission goes — the REAL subset of the prototype's routing rows:
 *  a campaign to enroll in (idempotent, the zapier-enroll shape), a tag the
 *  new contact carries, and the after-submit redirect. Calendar/Slack/webhook
 *  reactions ride AUTOMATIONS on `form.submitted.v1`, never bespoke wiring. */
export const formRoutingSchema = z.object({
  campaignId: z.string().nullable().optional(),
  /** WRITE-side convenience only: the console picks an agent; the server
   *  resolves its campaign and stores campaignId (never this). */
  agentId: z.string().optional(),
  tag: z.string().max(48).optional(),
  redirectUrl: z.string().url().max(500).optional(),
});
export type FormRouting = z.infer<typeof formRoutingSchema>;

export const FORM_STATUSES = ["draft", "live"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const formWriteSchema = z.object({
  title: z.string().min(1).max(140),
  /** Shown above the fields on the hosted page. */
  intro: z.string().max(300).optional(),
  submitLabel: z.string().min(1).max(60).optional(),
  fields: z.array(formFieldSchema).min(1).max(12),
  routing: formRoutingSchema.optional(),
});
export type FormWrite = z.infer<typeof formWriteSchema>;

export const formPatchSchema = formWriteSchema.partial().extend({
  status: z.enum(FORM_STATUSES).optional(),
});
export type FormPatch = z.infer<typeof formPatchSchema>;

/** The public submit body: answers keyed by field key, strings only (the
 *  hosted page is a plain form; types are validated server-side per spec). */
export const formSubmitSchema = z.object({
  answers: z.record(z.string(), z.string().max(2000)).refine((r) => Object.keys(r).length <= 24, {
    message: "too many answers",
  }),
});
export type FormSubmit = z.infer<typeof formSubmitSchema>;

/** Identity fields the contact write reads when present, by TYPE. */
export const FORM_IDENTITY_TYPES: ReadonlyArray<FormFieldType> = ["email", "phone"];
