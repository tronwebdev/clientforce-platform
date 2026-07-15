/**
 * W2 (#94) — the shared sub-campaign creator, at this repo's web-test level
 * (static markup + pure logic; the vitest environment is node, no DOM, so
 * click-through flows belong to the staging e2e): canon anatomy at the
 * initial step, the DEC-076 live notice, honest-absence option rendering,
 * deterministic brief derivation, the honest AI compose orchestration (real
 * endpoint shapes, cf mocked) and the exact W1 POST body.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createSubcampaignSchema, stepBriefSchema } from "@clientforce/core";
import type { CampaignRuleTrigger } from "@clientforce/core";
import { LIVE_GRAPH_NOTICE } from "../components/sequence/shared";
import {
  AI_DRAFT_FALLBACK,
  buildCreateBody,
  composeSubcampaignDraft,
  deriveSubcampaignBriefs,
  doneBodyCopy,
  seedFromDrafts,
  SUBCAMPAIGN_DRAFT_GAP_DAYS,
  SubcampaignCreator,
  TriggerMenu,
  type SubcampaignCreatorProps,
} from "../components/sequence/SubcampaignCreator";

const TRIGGER: CampaignRuleTrigger = { kind: "reply_classified", intents: ["interested"] };

function creator(over: Partial<SubcampaignCreatorProps> = {}) {
  return (
    <SubcampaignCreator
      open
      onClose={() => {}}
      agentId="agent-1"
      isDraft
      cf={async () => ({})}
      connected={{ email: true, leadCapture: false }}
      goal="book_appointments"
      onCreated={() => {}}
      {...over}
    />
  );
}

/** A minimal stored graph with one email step — the compose anchor. */
const GRAPH_RES = {
  graph: {
    graph: {
      entry: "step-1",
      nodes: [
        { id: "step-1", type: "step", channel: "email", content: { subject: "Hello", body: "Hi there" } },
        { id: "end-1", type: "end" },
      ],
      edges: [{ from: "step-1", to: "end-1" }],
    },
  },
};

describe("SubcampaignCreator (modal anatomy — initial render)", () => {
  it("closed → renders nothing", () => {
    expect(renderToStaticMarkup(creator({ open: false }))).toBe("");
  });

  it("step 0 carries the canon strings, testids and footer", () => {
    const html = renderToStaticMarkup(creator());
    expect(html).toContain('data-testid="subnew-modal"');
    expect(html).toContain("New sub-campaign");
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain("When should contacts enter this branch?");
    expect(html).toContain("Pick the behaviour that moves a contact into this sub-campaign.");
    expect(html).toContain('data-testid="subnew-trigger-select"');
    expect(html).toContain("Select a trigger…");
    expect(html).toContain('data-testid="subnew-name"');
    expect(html).toContain('placeholder="Interested follow-up"');
    expect(html).toContain("Cancel");
    expect(html).toContain("Continue");
  });

  it("launched agents (isDraft=false) render the DEC-076 live-graph notice; drafts don't", () => {
    const launched = renderToStaticMarkup(creator({ isDraft: false }));
    expect(launched).toContain('data-testid="subnew-live-notice"');
    expect(launched).toContain(LIVE_GRAPH_NOTICE);
    expect(renderToStaticMarkup(creator({ isDraft: true }))).not.toContain("subnew-live-notice");
  });
});

describe("TriggerMenu (honest absence)", () => {
  it("connected.email=false renders email-backed options dimmed with the reason; meeting_booked stays live", () => {
    const html = renderToStaticMarkup(
      <TriggerMenu connected={{ email: false, leadCapture: false }} selected={null} onPick={() => {}} />,
    );
    for (const kind of [
      "reply_classified",
      "sequence_quiet",
      "email_opened",
      "link_clicked",
      "meeting_booked",
      "opted_out",
      "lead_captured",
    ]) {
      expect(html).toContain(`data-testid="subnew-trigger-option-${kind}"`);
    }
    expect(html).toContain("Connect an email sender first");
    expect(html).toContain("Arrives with lead capture sources");
    // 5 email-backed + lead_captured dim; meeting_booked keeps full opacity + pointer
    expect(html.match(/opacity:0\.55/g)).toHaveLength(6);
    expect(html.match(/cursor:pointer/g)).toHaveLength(1);
    // Disabled options carry no click affordance — a click cannot select
    // (the availability gate is asserted exhaustively in subcampaign-triggers).
    expect(html.match(/cursor:default/g)).toHaveLength(6);
  });

  it("connected → all options live, the selected kind shows the ✓", () => {
    const html = renderToStaticMarkup(
      <TriggerMenu connected={{ email: true, leadCapture: true }} selected={"email_opened"} onPick={() => {}} />,
    );
    expect(html).not.toContain("opacity:0.55");
    expect(html.match(/cursor:pointer/g)).toHaveLength(7);
    expect(html).toContain("✓");
  });
});

describe("deterministic brief derivation (the honest-AI seed)", () => {
  it("same inputs → the same two briefs, valid against stepBriefSchema", () => {
    const a = deriveSubcampaignBriefs(TRIGGER, "Interested follow-up", "book_appointments");
    const b = deriveSubcampaignBriefs(TRIGGER, "Interested follow-up", "book_appointments");
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    for (const brief of a) expect(stepBriefSchema.safeParse(brief).success).toBe(true);
    // The opener carries a subject direction; the threaded follow-up doesn't.
    expect(a[0].subjectHint).toBeTruthy();
    expect(a[1].subjectHint).toBeUndefined();
    // Trigger + name + goal all steer the briefs — with the VERBATIM intent label.
    expect(a[0].objective).toContain("Interested follow-up");
    expect(a[0].objective).toContain('"Interested"');
    expect(a[0].objective).toContain("book a time on the calendar");
  });

  it("quiet-trigger briefs cite the real day count", () => {
    const [first] = deriveSubcampaignBriefs({ kind: "sequence_quiet", days: 45 }, "Re-engage", null);
    expect(first.objective).toContain("45 days of quiet");
  });
});

describe("composeSubcampaignDraft (the REAL sandbox composer, cf mocked)", () => {
  it("stages each derived brief through planner/compose-preview and returns the composed copy", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const cf = async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path.startsWith("planner/graph")) return GRAPH_RES;
      const body = JSON.parse(String(init?.body)) as { brief: { objective: string } };
      return { composed: { subject: `S · ${body.brief.objective.slice(0, 10)}`, body: "Composed body." } };
    };
    const briefs = deriveSubcampaignBriefs(TRIGGER, "Interested follow-up", "book_appointments");
    const res = await composeSubcampaignDraft(cf, "agent-1", briefs);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.steps).toHaveLength(2);
    expect(res.steps[1]!.body).toBe("Composed body.");
    // The staged briefs are the derived ones VERBATIM — honest AI, no rewriting.
    expect(calls[0]!.path).toBe("planner/graph?agentId=agent-1");
    expect(calls[1]).toEqual({
      path: "planner/compose-preview",
      body: { agentId: "agent-1", stepNodeId: "step-1", brief: briefs[0] },
    });
    expect(calls[2]).toEqual({
      path: "planner/compose-preview",
      body: { agentId: "agent-1", stepNodeId: "step-1", brief: briefs[1] },
    });
  });

  it("a composer refusal, a thrown cf, or a graph without an email step all fall back honestly", async () => {
    const refusing = async (path: string) =>
      path.startsWith("planner/graph") ? GRAPH_RES : { refused: { reason: "grounding", detail: "…" } };
    expect(await composeSubcampaignDraft(refusing, "a", deriveSubcampaignBriefs(TRIGGER, "x", null))).toEqual({
      ok: false,
    });
    const throwing = async () => {
      throw new Error("planner/compose-preview: 503");
    };
    expect(await composeSubcampaignDraft(throwing, "a", [])).toEqual({ ok: false });
    const emptyGraph = async () => ({ graph: { graph: { entry: "e", nodes: [{ id: "e", type: "end" }], edges: [] } } });
    expect(await composeSubcampaignDraft(emptyGraph, "a", [])).toEqual({ ok: false });
    // The fallback line the review step shows — never canned copy presented as AI.
    expect(AI_DRAFT_FALLBACK).toBe("AI draft unavailable — starting from scratch");
  });
});

describe("the W1 POST body (planner/subcampaign)", () => {
  it("AI builds submit the composed scripted steps: opener + threaded follow-up after the gap", () => {
    const seed = seedFromDrafts([
      { subject: "Booking?", body: "Hi {{firstName}}, grab a slot." },
      { subject: "ignored for threaded", body: "Still open, {{firstName}}." },
    ]);
    expect(seed).toEqual([
      { channel: "email", content: { subject: "Booking?", body: "Hi {{firstName}}, grab a slot." } },
      {
        channel: "email",
        content: { body: "Still open, {{firstName}}.", threaded: true },
        delayDays: SUBCAMPAIGN_DRAFT_GAP_DAYS,
      },
    ]);
    const body = buildCreateBody("agent-1", "  Interested follow-up ", TRIGGER, [
      { subject: "Booking?", body: "Hi." },
      { subject: "", body: "Nudge." },
    ]);
    expect(body.agentId).toBe("agent-1");
    expect(body.name).toBe("Interested follow-up");
    expect(body.trigger).toEqual(TRIGGER);
    expect(body.seed).toHaveLength(2);
    // The exact body the modal POSTs parses under the W1 schema itself.
    expect(createSubcampaignSchema.safeParse(body).success).toBe(true);
  });

  it("scratch builds submit an EMPTY seed — nothing invented", () => {
    const body = buildCreateBody("agent-1", "Quiet re-engage", { kind: "sequence_quiet", days: 30 }, null);
    expect(body.seed).toEqual([]);
    expect(createSubcampaignSchema.safeParse(body).success).toBe(true);
  });

  it("done copy reports the REAL drafted step count; the scratch line is the designed copy", () => {
    expect(doneBodyCopy(true, 2)).toBe(
      "AI drafted a 2-step sequence for this branch. It runs automatically when a contact matches the trigger.",
    );
    expect(doneBodyCopy(false, 0)).toBe(
      "It runs automatically when a contact matches the trigger — add steps whenever you're ready.",
    );
  });
});
