import { z } from "zod";

/**
 * B5 (DEC-130): the PROPOSAL contract — DRAFT documents only. The tables and
 * the four proposal.* events shipped at init with a fully-built read path and
 * no writer; B5 gives the DOCUMENT half code (create, edit blocks, render).
 * The DELIVERY half — sending, tracked links, viewed/accepted/paid, e-sign,
 * the Stripe deposit link — is the absent spine Q-100 carries: until it
 * lands, no proposal.* event is published and `status` stays "draft"
 * (the write boundary refuses anything else).
 *
 * Grounding stance (the prototype's own doctrine, "she never invents a
 * number"): prices are typed by the OWNER or seeded from the business core by
 * the guided build's deterministic path — nothing here composes copy.
 */
export const proposalBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cover"),
    eyebrow: z.string().max(80).optional(),
    title: z.string().min(1).max(140),
    body: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    label: z.string().max(60).optional(),
    title: z.string().min(1).max(140),
    body: z.string().max(2000),
  }),
  z.object({
    kind: z.literal("price"),
    label: z.string().max(60).optional(),
    title: z.string().min(1).max(140),
    options: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          sub: z.string().max(160).optional(),
          amount: z.string().min(1).max(40),
          best: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(5),
  }),
  z.object({
    kind: z.literal("signature"),
    label: z.string().max(60).optional(),
    body: z.string().max(300).optional(),
  }),
]);
export type ProposalBlock = z.infer<typeof proposalBlockSchema>;

export const PROPOSAL_STATUSES = ["draft"] as const;

export const proposalWriteSchema = z.object({
  title: z.string().min(1).max(140),
  contactId: z.string().nullable().optional(),
  blocks: z.array(proposalBlockSchema).min(1).max(12),
});
export type ProposalWrite = z.infer<typeof proposalWriteSchema>;

export const proposalPatchSchema = proposalWriteSchema.partial();
export type ProposalPatch = z.infer<typeof proposalPatchSchema>;
