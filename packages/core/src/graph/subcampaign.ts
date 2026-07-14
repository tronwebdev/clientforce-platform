/**
 * #90 (DEC-077): the sub-campaign creator's typed DTO. The entry trigger is
 * R1's vocabulary CONSUMED VERBATIM (`campaignRuleTriggerSchema` — never a
 * parallel union; `reply_classified.intents` are additionally bounded by
 * `IntentSchema` at the API boundary, the schema's own documented contract).
 * Seed steps mirror the graph's own step shape: scripted copy OR a brief,
 * never both (`validateGraph` re-checks the exclusivity structurally).
 */
import { z } from "zod";
import { campaignRuleTriggerSchema } from "../campaign-rules";
import { stepBriefSchema, stepContentSchema } from "./validate";

export const SUBCAMPAIGN_NAME_MAX = 80;
export const SUBCAMPAIGN_SEED_MAX = 10;

export const subcampaignSeedStepSchema = z
  .object({
    channel: z.enum(["email", "sms"]),
    content: stepContentSchema.optional(),
    brief: stepBriefSchema.optional(),
    delayDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((s) => !(s.content && s.brief), {
    message: "A seed step carries copy or a brief, never both",
  });

export const createSubcampaignSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).max(SUBCAMPAIGN_NAME_MAX),
  trigger: campaignRuleTriggerSchema,
  seed: z.array(subcampaignSeedStepSchema).max(SUBCAMPAIGN_SEED_MAX).default([]),
});

export type SubcampaignSeedStepInput = z.infer<typeof subcampaignSeedStepSchema>;
export type CreateSubcampaignInput = z.infer<typeof createSubcampaignSchema>;
