import { z } from "zod";

/**
 * C2.8 — Contact lists (docs/PLAN_CONTACT_LISTS.md). Lists are explicit
 * stored membership ("Q3 dental leads"); segments stay derived queries.
 * Origins "form" | "widget" | "automation" are RESERVED for the integrations
 * — clients can only create manual / csv_import lists in v1.
 */
export const CLIENT_LIST_ORIGINS = ["manual", "csv_import"] as const;

export const createContactListSchema = z.object({
  name: z.string().trim().min(1).max(80),
  origin: z.enum(CLIENT_LIST_ORIGINS).optional(),
  /** "New list from selection": assign these contacts on create. */
  contactIds: z.array(z.string().min(1)).max(10_000).optional(),
});
export type CreateContactListInput = z.infer<typeof createContactListSchema>;

export const updateContactListSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** Archive, never delete — archived lists leave every picker, membership stays. */
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.archived !== undefined, {
    message: "Provide name and/or archived",
  });
export type UpdateContactListInput = z.infer<typeof updateContactListSchema>;

export const contactListMembersSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(10_000),
});
export type ContactListMembersInput = z.infer<typeof contactListMembersSchema>;

/** One list row as every picker/rail consumes it. */
export interface ContactListDto {
  id: string;
  name: string;
  origin: string;
  archived: boolean;
  memberCount: number;
  createdAt: string;
}
