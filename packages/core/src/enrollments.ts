/**
 * Enrollment REST DTOs (P1.6, A2) — shared by api + web.
 *
 * Enrolling a contact starts one durable CampaignWorkflow (workflow id
 * `enroll-<enrollmentId>` — double-enroll is a no-op by id). The signal-reply
 * endpoint is the dev/testing surface until P1.7 wires the inbound classifier
 * to send the same signal.
 */
import { z } from "zod";

export const createEnrollmentSchema = z.object({
  agentId: z.string().min(1),
  contactId: z.string().min(1),
  /** Optional — defaults to the workspace's first ACTIVE sender connection. */
  senderId: z.string().min(1).optional(),
});
export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;

export const listEnrollmentsQuerySchema = z.object({
  agentId: z.string().min(1),
});
export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;

/** Intent is an opaque string here (the classifier's enum lives in @clientforce/events). */
export const signalReplySchema = z.object({
  intent: z.string().min(1),
});
export type SignalReplyInput = z.infer<typeof signalReplySchema>;
