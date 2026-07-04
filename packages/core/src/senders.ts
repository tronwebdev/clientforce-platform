/**
 * Sender REST DTOs (P1.5, A2). CF_MANAGED is always creatable; the OAuth/SMTP
 * tiers are designed-but-inert this phase (the API returns 400 with the same
 * "coming soon" semantics as the prototype's connect surface).
 */
import { z } from "zod";

export const senderTypeSchema = z.enum(["CF_MANAGED", "GMAIL_OAUTH", "OUTLOOK_OAUTH", "SMTP"]);
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

export const testSendSchema = z.object({
  senderId: z.string().min(1),
  agentId: z.string().min(1),
  /** Allow-listed recipient only this phase (§G test inbox). */
  to: z.string().email(),
});
export type TestSendDto = z.infer<typeof testSendSchema>;
