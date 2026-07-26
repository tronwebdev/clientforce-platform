/**
 * SPEC A (DEC-094): the tool the model sees. Its descriptions are hand-written
 * (they decide whether the brain reaches for a lookup at the right moment), so
 * the ENUM is drift-guarded against the vocabulary of record instead — the
 * wording stays editable, the facet list cannot silently diverge.
 */
import { describe, expect, it } from "vitest";
import { RECALL_FACETS, RECALL_FACET_META, RECALL_TOOL_NAME } from "@clientforce/core";
import { buildRecallTool } from "../src/tool";

describe("buildRecallTool", () => {
  const tool = buildRecallTool();
  const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;

  it("is named as the vocabulary of record names it", () => {
    expect(tool.name).toBe(RECALL_TOOL_NAME);
  });

  it("enumerates EXACTLY the RECALL_FACETS union — drift guard", () => {
    expect(props.facet!.enum).toEqual([...RECALL_FACETS]);
  });

  it("describes every facet, so the model can pick between them", () => {
    for (const facet of RECALL_FACETS) {
      expect(props.facet!.description ?? "").toContain(RECALL_FACET_META[facet].describes);
    }
  });

  it("requires both facet and query, and rejects extra properties", () => {
    expect(tool.inputSchema.required).toEqual(["facet", "query"]);
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it("tells the model what to do when the record is silent", () => {
    // The honest-absence rule has to live in the tool description too: the
    // system prompt is far away by the time the result comes back.
    expect(tool.description).toContain("nothing on record");
    expect(tool.description).toContain("never fill the gap yourself");
  });
});
