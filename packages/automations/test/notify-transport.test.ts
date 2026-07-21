/**
 * INT W1 (DEC-093, Q-042): the notify_team transport seam. Pins the
 * load-bearing contract: ABSENT transport keeps pre-W1 behavior
 * byte-identical (run row + Logs row remain the transport of record);
 * a wired transport adds delivery evidence to the detail; a transport
 * FAILURE never changes the outcome. Pure unit — notify_team touches no DB.
 */
import { describe, expect, it } from "vitest";
import type { CampaignRuleAction } from "@clientforce/core";
import { executeAction } from "../src/executors";
import type { RuleEngineDeps, RunContext } from "../src/types";

const ctx = (): RunContext => ({
  workspaceId: "ws1",
  campaignId: "camp1",
  eventId: "evt-1",
  contactId: "contact-1",
  enrollmentId: null,
  depth: 0,
  terminalState: { fired: false },
});

const action: CampaignRuleAction = { kind: "notify_team", note: "Hot lead" };
const bareDeps = { prisma: null as never } as RuleEngineDeps;

describe("notify_team transport seam", () => {
  it("ABSENT transport: pre-W1 behavior byte-identical (note as detail, executed)", async () => {
    const outcome = await executeAction(bareDeps, ctx(), "rule-1", action);
    expect(outcome).toEqual({ kind: "notify_team", outcome: "executed", detail: "Hot lead" });
    const bare = await executeAction(bareDeps, ctx(), "rule-1", { kind: "notify_team" });
    expect(bare).toEqual({ kind: "notify_team", outcome: "executed" });
  });

  it("wired transport: called with the rule+action-scoped dedupe key; delivery evidence rides the detail", async () => {
    const calls: Array<{ workspaceId: string; sourceKey: string; note?: string; contactId?: string | null }> = [];
    const deps: RuleEngineDeps = {
      ...bareDeps,
      notifyTransport: async (params) => {
        calls.push(params);
        return { delivered: true, target: "#alerts" };
      },
    };
    const outcome = await executeAction(deps, ctx(), "rule-1", action, "#a:0");
    expect(calls).toEqual([
      { workspaceId: "ws1", sourceKey: "evt-1#rule:rule-1#a:0", note: "Hot lead", contactId: "contact-1" },
    ]);
    expect(outcome.outcome).toBe("executed");
    expect(outcome.detail).toBe("Hot lead · delivered to Slack #alerts");
  });

  it("two notify actions under ONE rule get DISTINCT dedupe keys (review-round pin — no silent collapse)", async () => {
    const keys: string[] = [];
    const deps: RuleEngineDeps = {
      ...bareDeps,
      notifyTransport: async (params) => {
        keys.push(params.sourceKey);
        return { delivered: true, target: "#alerts" };
      },
    };
    // The engine loops rule.actions.entries() → "#a:<i>" — two notify_team
    // actions in one rule must both deliver.
    await executeAction(deps, ctx(), "rule-1", { kind: "notify_team", note: "first" }, "#a:0");
    await executeAction(deps, ctx(), "rule-1", { kind: "notify_team", note: "second" }, "#a:1");
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(["evt-1#rule:rule-1#a:0", "evt-1#rule:rule-1#a:1"]);
  });

  it("a dedupe-skipped redelivery is VISIBLE in the run detail, never a fresh-delivery claim", async () => {
    const deps: RuleEngineDeps = {
      ...bareDeps,
      notifyTransport: async () => ({ delivered: true, target: "#alerts", detail: "duplicate delivery skipped" }),
    };
    const outcome = await executeAction(deps, ctx(), "rule-1", action, "#a:0");
    expect(outcome.detail).toBe("Hot lead · delivered to Slack #alerts (duplicate delivery skipped)");
  });

  it("skipped delivery (no connection/channel) stays executed with the honest reason", async () => {
    const deps: RuleEngineDeps = {
      ...bareDeps,
      notifyTransport: async () => ({ delivered: false, detail: "slack not connected" }),
    };
    const outcome = await executeAction(deps, ctx(), "rule-1", action);
    expect(outcome.outcome).toBe("executed");
    expect(outcome.detail).toBe("Hot lead · Slack delivery skipped (slack not connected)");
  });

  it("transport FAILURE never fails the rule — outcome executed, failure in the detail", async () => {
    const deps: RuleEngineDeps = {
      ...bareDeps,
      notifyTransport: async () => {
        throw new Error("slack unreachable");
      },
    };
    const outcome = await executeAction(deps, ctx(), "rule-1", action);
    expect(outcome.outcome).toBe("executed");
    expect(outcome.detail).toBe("Hot lead · Slack delivery failed (slack unreachable)");
  });
});
