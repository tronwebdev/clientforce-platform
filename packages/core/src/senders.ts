/**
 * Sender REST DTOs (P1.5, A2). CF_MANAGED is always creatable; the OAuth/SMTP
 * tiers are designed-but-inert this phase (the API returns 400 with the same
 * "coming soon" semantics as the prototype's connect surface).
 */
import { z } from "zod";

export const senderTypeSchema = z.enum(["CF_MANAGED", "GMAIL_OAUTH", "OUTLOOK_OAUTH", "SMTP", "TWILIO_SMS"]);
export type SenderTypeDto = z.infer<typeof senderTypeSchema>;

export const createSenderSchema = z.object({
  type: senderTypeSchema,
  fromEmail: z.string().email().max(320),
  /** Owner rule 1: optional at creation, REQUIRED at send time (send fails without it). */
  fromName: z.string().min(1).max(120).optional(),
  replyTo: z.string().email().max(320).optional(),
  dailyLimit: z.number().int().min(1).max(10_000).optional(),
  sendingWindow: z.unknown().optional(),
});
export type CreateSenderDto = z.infer<typeof createSenderSchema>;

/**
 * P2.1 (DEC-061): the SMS sender create shape — E.164 phone + Twilio
 * messaging-service SID. Enum-only migration: the phone is STORED in the
 * `fromEmail` column for TWILIO_SMS rows (documented reuse); the SID rides
 * the field-encrypted `credentialsEnc` blob like every per-tenant credential.
 */
export const e164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164 phone, e.g. +15551234567");
export const createSmsSenderSchema = z.object({
  type: z.literal("TWILIO_SMS"),
  phone: e164Schema,
  /** Display label for Settings rows (not a send-time from-name — SMS has none). */
  fromName: z.string().min(1).max(120),
  messagingServiceSid: z.string().regex(/^MG[a-zA-Z0-9]{32}$/, "Twilio messaging service SID (MG…)"),
  dailyLimit: z.number().int().min(1).max(10_000).optional(),
});
export type CreateSmsSenderDto = z.infer<typeof createSmsSenderSchema>;

export const testSendSchema = z.object({
  senderId: z.string().min(1),
  agentId: z.string().min(1),
  /** Allow-listed recipient only this phase (§G test inbox). */
  to: z.string().email(),
});
export type TestSendDto = z.infer<typeof testSendSchema>;

/**
 * P5 W2 (DEC-084): Settings-side sender management — pause/resume (typed,
 * audited via `sender.status_changed.v1`) + the daily-limit edit. Status here
 * moves only between ACTIVE and PAUSED: DISABLED is a provisioning state, not
 * an owner toggle.
 */
export const updateSenderSchema = z
  .object({
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    dailyLimit: z.number().int().min(1).max(10_000).optional(),
  })
  .refine((v) => v.status !== undefined || v.dailyLimit !== undefined, {
    message: "Provide status and/or dailyLimit",
  });
export type UpdateSenderDto = z.infer<typeof updateSenderSchema>;
