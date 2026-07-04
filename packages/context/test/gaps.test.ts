import { describe, expect, it } from "vitest";
import type { ContextCitation, ContextFields } from "@clientforce/core";
import { checkGaps, coveredKeys, mergeLayers } from "../src/gaps";

const snapshot = (chunkId = "chunk-1"): ContextCitation => ({
  chunkId,
  sourceId: "src-1",
  sourceLabel: "site",
  sourceType: "TEXT",
  locator: "site",
  quote: "verbatim evidence",
});
const distilled = (
  value: string,
  citations: ContextCitation[] = [snapshot()],
): ContextFields[string] => ({
  value,
  citations,
  source: "distilled",
});
const typed = (value: string): ContextFields[string] => ({ value, citations: [], source: "typed" });
const delegated = (): ContextFields[string] => ({ value: "", citations: [], source: "ai_decides" });

describe("checkGaps (DEC-024/025)", () => {
  it("uncited required fields are open gaps; cited ones are covered", () => {
    const report = checkGaps({
      goal: "book_appointments",
      workspaceFields: { offer: distilled("We book appointments"), usp: distilled("Only us") },
      agentFields: {},
    });
    const by = Object.fromEntries(report.gaps.map((g) => [g.key, g]));
    expect(by.offer!.status).toBe("covered");
    expect(by.offer!.coveredBy).toBe("workspace");
    expect(by.usp!.status).toBe("covered");
    expect(by.tone!.status).toBe("open");
    expect(by.icp!.status).toBe("open");
    expect(by.booking_link!.status).toBe("open");
    expect(report.launchReady).toBe(false);
    expect(report.resolved).toBe(2);
    expect(report.total).toBe(report.gaps.length);
  });

  it("a distilled fill WITHOUT citations never resolves a gap (evidence-or-gap rule)", () => {
    const report = checkGaps({
      goal: "collect_reviews",
      workspaceFields: { offer: distilled("Guessed offer", []) },
      agentFields: {},
    });
    expect(report.gaps.find((g) => g.key === "offer")!.status).toBe("open");
  });

  it("typed and ai_decides resolve gaps; agent layer wins the merge", () => {
    const report = checkGaps({
      goal: "book_appointments",
      workspaceFields: { icp: distilled("Everyone") },
      agentFields: { icp: typed("Dentists in Austin"), booking_link: delegated() },
    });
    const by = Object.fromEntries(report.gaps.map((g) => [g.key, g]));
    expect(by.icp!.status).toBe("typed"); // agent typed beats workspace distilled
    expect(by.booking_link!.status).toBe("ai_decides");
  });

  it("agent-layer distills report coveredBy agent", () => {
    const report = checkGaps({
      goal: "drive_signups",
      workspaceFields: {},
      agentFields: { trial_details: distilled("14-day trial") },
    });
    const item = report.gaps.find((g) => g.key === "trial_details")!;
    expect(item.status).toBe("covered");
    expect(item.coveredBy).toBe("agent");
  });

  it("company_address is a WORKSPACE-layer gap for email goals; agent answers don't satisfy it (owner edit 3)", () => {
    const withAgentOnly = checkGaps({
      goal: "generate_leads",
      workspaceFields: {},
      agentFields: { company_address: typed("1 Main St") },
    });
    const gap = withAgentOnly.gaps.find((g) => g.key === "company_address")!;
    expect(gap.layer).toBe("workspace");
    expect(gap.status).toBe("open");

    const withWorkspace = checkGaps({
      goal: "generate_leads",
      workspaceFields: { company_address: distilled("1 Main St, Austin TX") },
      agentFields: {},
    });
    expect(withWorkspace.gaps.find((g) => g.key === "company_address")!.status).toBe("covered");

    const nonEmail = checkGaps({
      goal: "generate_leads",
      workspaceFields: {},
      agentFields: {},
      email: false,
    });
    expect(nonEmail.gaps.some((g) => g.key === "company_address")).toBe(false);
  });

  it("goal change re-runs evaluation: answers persist but no-longer-required keys drop out (kept, ignored)", () => {
    const agentFields: ContextFields = { booking_link: typed("https://cal.example") };
    const booked = checkGaps({ goal: "book_appointments", workspaceFields: {}, agentFields });
    expect(booked.gaps.some((g) => g.key === "booking_link")).toBe(true);
    const reviews = checkGaps({ goal: "collect_reviews", workspaceFields: {}, agentFields });
    expect(reviews.gaps.some((g) => g.key === "booking_link")).toBe(false);
    expect(reviews.gaps.some((g) => g.key === "review_channel")).toBe(true);
  });

  it("custom goal: non-dismissed proposed asks gate launch; dismissed ones vanish; answers resolve them", () => {
    const base = {
      goal: "custom" as const,
      workspaceFields: {
        offer: distilled("x"),
        usp: distilled("y"),
        tone: distilled("z"),
        company_address: distilled("1 Main St"),
      },
    };
    const open = checkGaps({
      ...base,
      agentFields: {},
      proposedAsks: [
        { key: "custom_ask_1", ask: "What is the webinar date?" },
        { key: "custom_ask_2", ask: "Who is the host?", dismissed: true },
      ],
    });
    expect(open.gaps.filter((g) => g.proposedAsk).map((g) => g.key)).toEqual(["custom_ask_1"]);
    expect(open.launchReady).toBe(false);

    const answered = checkGaps({
      ...base,
      agentFields: { custom_ask_1: typed("June 12") } as ContextFields,
      proposedAsks: [{ key: "custom_ask_1", ask: "What is the webinar date?" }],
    });
    expect(answered.gaps.find((g) => g.key === "custom_ask_1")!.status).toBe("typed");
    expect(answered.launchReady).toBe(true);
  });

  it("launchReady only when every required gap is typed, delegated, or covered", () => {
    const report = checkGaps({
      goal: "reactivate_leads",
      workspaceFields: {
        offer: distilled("a"),
        usp: distilled("b"),
        tone: distilled("c"),
        company_address: distilled("addr"),
        pricing: distilled("$99"),
      },
      agentFields: { winback_offer: typed("20% off"), availability: delegated() },
    });
    expect(report.launchReady).toBe(true);
    expect(report.resolved).toBe(report.total);
  });
});

describe("mergeLayers / coveredKeys", () => {
  it("agent wins the merged planner read; coveredKeys drops uncited distills", () => {
    const merged = mergeLayers(
      { offer: distilled("workspace offer"), tone: distilled("warm") },
      { offer: typed("agent offer") },
    );
    expect(merged.offer!.value).toBe("agent offer");
    expect(merged.tone!.value).toBe("warm");
    expect(coveredKeys({ offer: distilled("x"), usp: distilled("y", []) })).toEqual(["offer"]);
  });
});
