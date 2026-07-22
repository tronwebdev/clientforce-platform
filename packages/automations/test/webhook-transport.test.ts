/**
 * INT W3 (DEC-095): the send_webhook executor's seam semantics — the
 * notify-transport twin: absent transport = the honest recorded absence;
 * the dedupe key carries the action path; a delivery failure NEVER changes
 * the run outcome. Plus the send_payment_link flag (unit, no DB — the flag
 * walk itself rides the integrations suite).
 */
import { describe, expect, it } from "vitest";
import { executeAction } from "../src/executors";
import type { RuleEngineDeps, RunContext } from "../src/types";

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  workspaceId: "ws1",
  campaignId: "c1",
  eventId: "evt-1",
  contactId: "ct1",
  enrollmentId: "en1",
  depth: 0,
  terminalState: { fired: false },
  event: { type: "payment.received.v1", payload: { amount: 100 }, occurredAt: "2026-07-22T00:00:00.000Z" },
  ...over,
});

describe("send_webhook executor (INT W3)", () => {
  it("absent transport → executed with the honest recorded-only detail", async () => {
    const deps = { prisma: {} } as unknown as RuleEngineDeps;
    const out = await executeAction(deps, ctx(), "rule-1", { kind: "send_webhook" }, "#a:0");
    expect(out.outcome).toBe("executed");
    expect(out.detail).toContain("not wired");
  });

  it("wired transport receives the action-path dedupe key, the event content, and the url override", async () => {
    const calls: unknown[] = [];
    const deps = {
      prisma: {},
      webhookTransport: async (params: unknown) => {
        calls.push(params);
        return { delivered: true, target: "https://api.example/…" };
      },
    } as unknown as RuleEngineDeps;
    const out = await executeAction(
      deps,
      ctx(),
      "rule-1",
      { kind: "send_webhook", url: "https://api.example/hook" },
      "#a:2",
    );
    expect(out.outcome).toBe("executed");
    expect(out.detail).toContain("delivered");
    expect(calls[0]).toMatchObject({
      workspaceId: "ws1",
      sourceKey: "evt-1#rule:rule-1#a:2",
      url: "https://api.example/hook",
      event: { id: "evt-1", type: "payment.received.v1", payload: { amount: 100 } },
      rule: { id: "rule-1" },
    });
  });

  it("a sweep-fired context carries the synthetic sweep type", async () => {
    const calls: Array<{ event: { type: string } }> = [];
    const deps = {
      prisma: {},
      webhookTransport: async (params: { event: { type: string } }) => {
        calls.push(params);
        return { delivered: true };
      },
    } as unknown as RuleEngineDeps;
    await executeAction(
      deps,
      ctx({ event: { type: "sweep.before_meeting", payload: { meetingId: "m1" }, occurredAt: "2026-07-22T00:00:00.000Z" } }),
      "rule-1",
      { kind: "send_webhook" },
      "#a:0",
    );
    expect(calls[0]!.event.type).toBe("sweep.before_meeting");
  });

  it("transport failure NEVER changes the outcome — executed with the failure detail", async () => {
    const deps = {
      prisma: {},
      webhookTransport: async () => {
        throw new Error("vendor exploded");
      },
    } as unknown as RuleEngineDeps;
    const out = await executeAction(deps, ctx(), "rule-1", { kind: "send_webhook" }, "#a:0");
    expect(out.outcome).toBe("executed");
    expect(out.detail).toContain("vendor exploded");
  });

  it("a skipped delivery reports honestly (guard refusal detail rides through)", async () => {
    const deps = {
      prisma: {},
      webhookTransport: async () => ({ delivered: false, detail: "non-public address refused" }),
    } as unknown as RuleEngineDeps;
    const out = await executeAction(deps, ctx(), "rule-1", { kind: "send_webhook" }, "#a:0");
    expect(out.outcome).toBe("executed");
    expect(out.detail).toContain("skipped");
    expect(out.detail).toContain("non-public");
  });
});
