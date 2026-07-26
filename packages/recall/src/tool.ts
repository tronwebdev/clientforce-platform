/**
 * The tool the voice brain sees (SPEC A, DEC-094).
 *
 * Written out longhand rather than generated from the zod schema, because the
 * DESCRIPTIONS are the load-bearing part: they are the only thing that decides
 * whether the model reaches for a lookup at the right moment or answers a
 * pricing question from its own head. A drift guard in the tests pins the
 * facet enum against `RECALL_FACETS`, so the wording stays editable while the
 * vocabulary cannot silently diverge.
 */
import {
  RECALL_FACETS,
  RECALL_FACET_META,
  RECALL_TOOL_NAME,
  type RecallFacet,
} from "@clientforce/core";
import type { VoiceTool } from "@clientforce/ai";

const facetLines = (RECALL_FACETS as readonly RecallFacet[])
  .map((f) => `"${f}" — ${RECALL_FACET_META[f].describes}`)
  .join("; ");

export function buildRecallTool(): VoiceTool {
  return {
    name: RECALL_TOOL_NAME,
    description:
      "Look up what this business actually has on record before answering. " +
      "Use it whenever the caller asks about something you were not explicitly " +
      "told in your brief — what you discussed before, where they stand, a " +
      "previous booking, what is saved about them, or anything about price, " +
      "product, process or policy. One lookup answers one question: pick the " +
      "single facet that fits and put the caller's actual question in `query`. " +
      "If it comes back with nothing on record, tell the caller you do not have " +
      "that — never fill the gap yourself.",
    inputSchema: {
      type: "object",
      properties: {
        facet: {
          type: "string",
          enum: [...RECALL_FACETS],
          description: `Which record to search. ${facetLines}.`,
        },
        query: {
          type: "string",
          description:
            "What you are trying to find out, in your own words — usually the " +
            "caller's question. Used to rank results and recorded on the call.",
        },
      },
      required: ["facet", "query"],
      additionalProperties: false,
    },
  };
}
