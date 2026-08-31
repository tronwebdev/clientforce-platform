import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ROLE_SCOPE,
  WORKSPACE_ROLE_WORD,
  isWorkspaceFactKey,
  workspaceFactKey,
  workspaceFieldKey,
  workspaceRoleScope,
  workspaceRoleWord,
} from "../src/workspace-settings";

/**
 * The role vocabulary is a product ruling with no other guard: nothing in the
 * type system stops someone "tidying" AGENT back to "Agent", and the enum key
 * looks like the obvious label. So the ruling is pinned here.
 */
describe("workspace role vocabulary", () => {
  it("a person's third role is Member — Agent is Ada's", () => {
    expect(workspaceRoleWord("AGENT")).toBe("Member");
    expect(WORKSPACE_ROLE_WORD.AGENT).toBe("Member");
    // Nothing anywhere may render a human's role as "Agent".
    expect(Object.values(WORKSPACE_ROLE_WORD)).not.toContain("Agent");
  });

  it("the stored enum keeps its own keys — the word moved, the data did not", () => {
    expect(Object.keys(WORKSPACE_ROLE_WORD).sort()).toEqual(["ADMIN", "AGENT", "OWNER", "VIEWER"]);
    expect(Object.keys(WORKSPACE_ROLE_SCOPE).sort()).toEqual(["ADMIN", "AGENT", "OWNER", "VIEWER"]);
  });

  it("every role has a scope sentence, in the surface spec's own words", () => {
    expect(workspaceRoleScope("ADMIN")).toBe("Everything except billing and deleting the workspace");
    expect(workspaceRoleScope("AGENT")).toBe("Works the inbox, runs campaigns, cannot change guardrails");
    expect(workspaceRoleScope("VIEWER")).toBe("Reads everything, sends nothing");
    for (const role of Object.keys(WORKSPACE_ROLE_WORD)) {
      expect(workspaceRoleScope(role).length).toBeGreaterThan(10);
    }
  });

  it("an unknown role reads as itself rather than vanishing", () => {
    expect(workspaceRoleWord("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(workspaceRoleScope("SOMETHING_NEW")).toBe("");
  });
});

describe("taught-fact keys", () => {
  it("derives one stable key per question, so re-teaching edits instead of duplicating", () => {
    expect(workspaceFactKey("Do you take my insurance?")).toBe("ask_do_you_take_my_insurance");
    expect(workspaceFactKey("Do you take my insurance?")).toBe(workspaceFactKey("do you TAKE my insurance"));
  });

  it("keeps taught keys distinguishable from the business core's registry keys", () => {
    expect(isWorkspaceFactKey(workspaceFactKey("Parking?"))).toBe(true);
    expect(isWorkspaceFactKey(workspaceFieldKey("Parking"))).toBe(true);
    expect(isWorkspaceFactKey("pricing")).toBe(false);
    expect(isWorkspaceFactKey("company_address")).toBe(false);
  });
});
