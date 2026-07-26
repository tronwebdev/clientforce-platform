/**
 * INT W5 (DEC-101) — the Zapier app's INBOUND-WRITE vocabulary + REST DTOs.
 *
 * Zapier has two surfaces and they derive from DIFFERENT sources of truth, on
 * purpose:
 *
 *  - **Actions a Zap performs on an existing enrollment** derive from the ONE
 *    rule-action registry (`campaignRuleActionSchema`). That mapping lives in
 *    `@clientforce/integrations` (it also needs the event catalog) and is a
 *    non-Partial Record over `CampaignRuleActionKind`, so a NEW registry kind
 *    is a COMPILE ERROR until someone makes a Zapier decision about it.
 *
 *  - **Inbound writes** — this file. Creating a contact or enrolling one is not
 *    a rule action and never will be: a rule fires ON an existing contact,
 *    whereas these CREATE or ROUTE the record itself. Modelling them as rule
 *    kinds would be a category error (owner ruling, 2026-07-26), so they get
 *    their own registry — pinned exhaustively the same way, for the same
 *    reason: `zapierInboundWriteSchemas` is a non-Partial Record, so a new
 *    write kind cannot ship without its payload contract.
 *
 * DELIBERATELY ABSENT: `send_to_channel`. Anything that sends must ride the
 * send boundary's rails, and Q-039 / DEC-091 pt 9 hold that a send re-enters
 * the vocabulary ONLY on the PR that wires its channel's boundary rail. An
 * external Zap posting arbitrary content to a contact would bypass compose
 * grounding, the compliance literals, suppression and opt-out in a single hop
 * — Zapier being convenient is not a reason to make the first exception
 * (owner ruling; re-entry tracked as Q-057).
 */
import { z } from "zod";

/**
 * The inbound writes a Zap may perform. Order is the Zapier menu order.
 * Adding a kind here forces a payload schema below (non-Partial Record) and a
 * spec in the integrations-side manifest builder — the picker-drift discipline
 * applied to a second registry.
 */
export const ZAPIER_INBOUND_WRITE_KINDS = [
  "create_contact",
  "update_contact",
  "enroll_in_campaign",
] as const;
export type ZapierInboundWriteKind = (typeof ZAPIER_INBOUND_WRITE_KINDS)[number];

export const isZapierInboundWriteKind = (value: string): value is ZapierInboundWriteKind =>
  (ZAPIER_INBOUND_WRITE_KINDS as readonly string[]).includes(value);

/**
 * Contact identity for an inbound write. Email OR phone must be present —
 * a contact with neither is unreachable and un-dedupable, so we refuse it at
 * the boundary rather than storing a row nothing can ever match.
 */
const contactIdentity = {
  email: z.string().email().max(320).optional(),
  phone: z.string().min(3).max(40).optional(),
};

const contactFields = {
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  company: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(60)).max(25).optional(),
  /** C2.7 custom-field values keyed by ContactFieldDef.key — never enrichment. */
  custom: z.record(z.string().min(1).max(60), z.string().max(2000)).optional(),
};

export const zapierCreateContactSchema = z
  .object({ ...contactIdentity, ...contactFields })
  .strict()
  .refine((v) => Boolean(v.email ?? v.phone), {
    message: "email or phone is required",
  });

/**
 * Update matches an EXISTING contact by email or phone and never creates one:
 * a Zap that silently created rows on a typo'd address would fill the
 * workspace with junk. No match → a typed CONTACT_NOT_FOUND refusal.
 */
export const zapierUpdateContactSchema = z
  .object({ ...contactIdentity, ...contactFields })
  .strict()
  .refine((v) => Boolean(v.email ?? v.phone), {
    message: "email or phone is required to match the contact",
  });

/**
 * Enrolment routes an existing (or just-created) contact into a campaign. The
 * enrolment itself still rides the REAL enrolment path — suppression, opt-out
 * and the LH1 email-verdict gate all apply, and a refusal comes back typed
 * rather than as a silent no-op (`contact.enrollment_refused.v1` is the
 * record). Zapier never gets a side door into enrolment.
 */
export const zapierEnrollSchema = z
  .object({
    campaignId: z.string().min(1).max(60),
    ...contactIdentity,
  })
  .strict()
  .refine((v) => Boolean(v.email ?? v.phone), {
    message: "email or phone is required to match the contact",
  });

/**
 * Payload contract per inbound write. NON-PARTIAL on purpose: a new
 * `ZapierInboundWriteKind` is a compile error here until its contract exists,
 * so the registry can never drift from what the rail actually accepts.
 */
export const zapierInboundWriteSchemas: Record<ZapierInboundWriteKind, z.ZodTypeAny> = {
  create_contact: zapierCreateContactSchema,
  update_contact: zapierUpdateContactSchema,
  enroll_in_campaign: zapierEnrollSchema,
};

/** The polling cursor a Zapier trigger sends back to us. */
export const zapierPollQuerySchema = z
  .object({
    /** ISO-8601. Absent = the first poll; the rail returns a bounded page. */
    since: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/** Auth-test response — Zapier renders `label` as the connection title. */
export const zapierMeSchema = z
  .object({
    workspaceId: z.string(),
    label: z.string(),
    agencyName: z.string().optional(),
  })
  .strict();

/** Typed refusals for the Zapier rail (the INTEGRATION_REFUSALS convention). */
export const ZAPIER_REFUSALS = {
  KEY_INVALID: "That API key is not valid — copy it again from Settings → Integrations → Zapier",
  KEY_REVOKED: "That API key has been revoked — mint a new one in Settings → Integrations → Zapier",
  CONTACT_NOT_FOUND:
    "No contact matches that email or phone — use “Create contact” first, or check the value",
  CONTACT_EXISTS: "A contact with that email or phone already exists — use “Update contact” instead",
  CAMPAIGN_NOT_FOUND: "No campaign with that id in this workspace",
  IDENTITY_REQUIRED: "Provide an email or a phone number — a contact needs at least one",
  UNKNOWN_TRIGGER: "Unknown trigger key",
  UNKNOWN_WRITE: "Unknown action key",
} as const;
