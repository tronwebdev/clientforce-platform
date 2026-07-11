/**
 * Merged BusinessContext → prompt text (G1, DEC-070). ONE renderer shared by
 * the planner (P1.4) and the SMS composer so the two prompts can never fork on
 * what "the business context" says — both read the same labeled, non-empty
 * field lines (the model's only permitted fact source, DEC-015).
 */
import { CONTEXT_FIELD_META, type ContextFieldKey, type ContextFields } from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { parseFields } from "./distill";
import { mergeLayers } from "./gaps";

/** Non-empty context values, labeled — `- key (label): value` per line. */
export function renderContextText(fields: ContextFields): string {
  return Object.entries(fields)
    .filter(([, v]) => v.value.trim().length > 0)
    .map(([key, v]) => {
      const label = CONTEXT_FIELD_META[key as ContextFieldKey]?.label ?? key;
      return `- ${key} (${label}): ${v.value}`;
    })
    .join("\n");
}

/**
 * Load both layers (DEC-025: workspace + agent overlay, agent wins), merge,
 * render. Empty string = no usable context — callers refuse to generate
 * (DEC-015: no context, no grounded copy).
 */
export async function loadMergedContextText(
  prisma: PrismaClient,
  target: { workspaceId: string; agentId: string },
): Promise<string> {
  const { workspaceId, agentId } = target;
  const [workspaceRow, agentRow] = await withTenant(prisma, { workspaceId }, (tx) =>
    Promise.all([
      tx.businessContext.findFirst({ where: { workspaceId, agentId: null } }),
      tx.businessContext.findFirst({ where: { workspaceId, agentId } }),
    ]),
  );
  return renderContextText(
    mergeLayers(parseFields(workspaceRow?.fields), parseFields(agentRow?.fields)),
  );
}
