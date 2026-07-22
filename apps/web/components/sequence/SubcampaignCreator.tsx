"use client";

/**
 * "New sub-campaign" creator (W2, PR #94 — Campaign View canon, literals
 * verbatim). ONE shared component for BOTH hosts (Create Agent wizard step 2
 * · agent-view Steps tab) — the StepEditorDrawer precedent: host deltas ride
 * PROPS ONLY (each host passes ITS cf helper, its connectivity, its refresh),
 * never a fork.
 *
 * 3-step modal: trigger (R1's `campaignRuleTriggerSchema` kinds via the
 * lib/triggers display map — never a parallel union) → build method → review;
 * then the done state. Honest AI throughout: "Let AI draft it" derives two
 * briefs DETERMINISTICALLY (trigger+name+goal — mechanical, the
 * graph/seed.ts philosophy) and composes them through the REAL sandbox
 * composer (`planner/compose-preview` with a staged brief); every AI-drafted
 * value renders ✦-marked in review (the SeedChip convention). A compose
 * failure/refusal falls back honestly — the owner sees "AI draft unavailable
 * — starting from scratch", never canned copy presented as AI. Creation is
 * the W1 endpoint (`POST planner/subcampaign`); a 422's `detail` renders
 * verbatim in the modal (#88 precedent — no stuck busy state).
 */
import { useEffect, useRef, useState } from "react";
import { SUBCAMPAIGN_NAME_MAX } from "@clientforce/core";
import type {
  CampaignGraph,
  CampaignRuleTrigger,
  CampaignRuleTriggerKind,
  StepBrief,
  StepNode,
  SubcampaignSeedStepInput,
} from "@clientforce/core";
import { intentTint } from "../../lib/intents";
import { mainSteps } from "../../lib/graph-path";
import {
  REPLY_INTENT_OPTIONS,
  TRIGGER_OPTIONS,
  triggerAvailability,
  triggerChip,
  triggerLabel,
  type TriggerConnectivity,
} from "../../lib/triggers";
import { CfError, GRAD, LIVE_GRAPH_NOTICE } from "./shared";

/** The host's cf helper — each host passes ITS OWN (both throw CfError). */
export type CfFetch = (path: string, init?: RequestInit) => Promise<unknown>;

/** The honest fallback line when the sandbox composer fails or refuses. */
export const AI_DRAFT_FALLBACK = "AI draft unavailable — starting from scratch";

/** Deterministic gap before the drafted follow-up step (mechanical, not AI). */
export const SUBCAMPAIGN_DRAFT_GAP_DAYS = 3;

/** Owner-readable phrase for WHY a contact enters the branch — mechanical. */
function triggerPhraseOf(trigger: CampaignRuleTrigger): string {
  switch (trigger.kind) {
    case "reply_classified":
      return `their reply classified ${trigger.intents.map((i) => `"${intentTint(i).label}"`).join(" / ")}`;
    case "sequence_quiet":
      return `${trigger.days} day${trigger.days === 1 ? "" : "s"} of quiet after the sequence ended`;
    case "email_opened":
      return "opening an email without replying";
    case "link_clicked":
      return "clicking a link without replying";
    case "meeting_booked":
      return "booking a meeting";
    // INT W2 (DEC-094): the three meeting kinds light up in TRIGGER_OPTIONS —
    // this exhaustive switch registers their mechanical phrases.
    case "meeting_rescheduled":
      return "their meeting being rescheduled";
    case "meeting_canceled":
      return "their meeting falling through";
    case "before_meeting":
      return `their meeting starting within ${trigger.hours} hour${trigger.hours === 1 ? "" : "s"}`;
    case "opted_out":
      return "opting out";
    case "lead_captured":
      return "arriving through lead capture";
    // INT W3 (DEC-095): the payments wave's mechanical phrase.
    case "payment_received":
      return "a payment landing";
  }
}

/** Mechanical goal phrase — steering material for the composer, never copy. */
function goalPhraseOf(goal: string | null): string {
  const phrases: Record<string, string> = {
    book_appointments: "book a time on the calendar",
    generate_leads: "share what they need so you can qualify them",
    reactivate_leads: "pick the conversation back up",
    drive_signups: "start the sign-up",
    collect_reviews: "leave a review",
    promote_offer: "take the offer",
    fill_event: "register for the event",
    upsell_clients: "look at the upgrade",
  };
  return phrases[goal ?? ""] ?? "take the next step toward the goal";
}

/**
 * The two step briefs "Let AI draft it" composes — derived DETERMINISTICALLY
 * from trigger + name + goal (the graph/seed.ts philosophy: mechanical text
 * derivation, labeled as such; no model call happens here). The REAL AI is
 * the sandbox composer these briefs are staged through.
 */
export function deriveSubcampaignBriefs(
  trigger: CampaignRuleTrigger,
  name: string,
  goal: string | null,
): [StepBrief, StepBrief] {
  const clamp = (s: string, max = 200) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const why = triggerPhraseOf(trigger);
  const act = goalPhraseOf(goal);
  const branch = name.trim() || "this branch";
  return [
    {
      objective: clamp(`Open the "${branch}" branch: acknowledge ${why} and invite them to ${act}.`),
      subjectHint: clamp(`a short, direct line about ${act}`, 120),
      talkingPoints: [
        clamp(`This message sends because of ${why}.`),
        clamp(`The one next step for the contact is to ${act}.`),
        clamp(`This is the first message of the "${branch}" branch — set up the follow-up clearly.`),
      ],
    },
    {
      objective: clamp(
        `Follow up on the "${branch}" branch ${SUBCAMPAIGN_DRAFT_GAP_DAYS} days later: a short nudge that makes it easy to ${act}.`,
      ),
      talkingPoints: [
        clamp(`This is a short follow-up in the same thread, ${SUBCAMPAIGN_DRAFT_GAP_DAYS} days after the first branch message.`),
        clamp(`The contact entered this branch after ${why}.`),
        clamp(`Offer one clear, low-effort way to ${act}.`),
      ],
    },
  ];
}

export interface DraftedStep {
  subject: string;
  body: string;
}

/**
 * The honest AI draft: stage each derived brief through the REAL sandbox
 * composer (`planner/compose-preview` accepts {agentId, stepNodeId, brief}).
 * The staged brief needs an existing EMAIL step node to anchor on (channel
 * routing) — the current graph's first email step. Any failure or composer
 * refusal returns `{ ok: false }` so the caller falls back honestly (empty
 * seed + the AI_DRAFT_FALLBACK note — never canned copy presented as AI).
 */
export async function composeSubcampaignDraft(
  cf: CfFetch,
  agentId: string,
  briefs: StepBrief[],
): Promise<{ ok: true; steps: DraftedStep[] } | { ok: false }> {
  try {
    const res = (await cf(`planner/graph?agentId=${agentId}`)) as {
      graph?: { graph?: CampaignGraph } | null;
    };
    const graph = res.graph?.graph;
    const anchor: StepNode | undefined = graph
      ? (mainSteps(graph).find((s) => s.channel === "email") ??
        graph.nodes.find((n): n is StepNode => n.type === "step" && n.channel === "email"))
      : undefined;
    if (!anchor) return { ok: false };
    const steps: DraftedStep[] = [];
    for (const brief of briefs) {
      const out = (await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId, stepNodeId: anchor.id, brief }),
      })) as { composed?: { subject?: string; body?: string } };
      if (!out.composed?.body) return { ok: false }; // refused or malformed — honest fallback
      steps.push({ subject: out.composed.subject ?? "", body: out.composed.body });
    }
    return { ok: true, steps };
  } catch {
    return { ok: false };
  }
}

/** Drafted copy → the W1 seed shape (packages/core/src/graph/subcampaign.ts):
 *  first step opens the thread, later steps continue it after the gap. */
export function seedFromDrafts(drafts: DraftedStep[]): SubcampaignSeedStepInput[] {
  return drafts.map((d, i) =>
    i === 0
      ? { channel: "email" as const, content: { ...(d.subject ? { subject: d.subject } : {}), body: d.body } }
      : {
          channel: "email" as const,
          content: { body: d.body, threaded: true },
          delayDays: SUBCAMPAIGN_DRAFT_GAP_DAYS,
        },
  );
}

/** The exact W1 POST body (`planner/subcampaign`) — scratch builds submit an
 *  empty seed, AI builds submit the composed scripted steps. */
export function buildCreateBody(
  agentId: string,
  name: string,
  trigger: CampaignRuleTrigger,
  drafts: DraftedStep[] | null,
): { agentId: string; name: string; trigger: CampaignRuleTrigger; seed: SubcampaignSeedStepInput[] } {
  return { agentId, name: name.trim(), trigger, seed: drafts ? seedFromDrafts(drafts) : [] };
}

/** Done-screen body copy. The scratch line is DESIGNED copy (no canon anchor
 *  — canon only wrote the AI build's sentence); flagged in the fidelity log. */
export function doneBodyCopy(builtWithAI: boolean, stepCount: number): string {
  return builtWithAI
    ? `AI drafted a ${stepCount}-step sequence for this branch. It runs automatically when a contact matches the trigger.`
    : "It runs automatically when a contact matches the trigger — add steps whenever you're ready.";
}

/** What a successful creation hands the host (the W1 response + the picked
 *  trigger): the wizard sets its graph/rules state directly, the Steps tab
 *  refetches. `builtWithAI` is IN-SESSION provenance only — not persisted. */
export interface SubcampaignCreated {
  graph: CampaignGraph;
  version: number;
  source: string;
  subcampaignId: string;
  ruleId: string;
  trigger: CampaignRuleTrigger;
  builtWithAI: boolean;
}

export interface SubcampaignCreatorProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  /** Launched agents (false) render the DEC-076 versioning notice. */
  isDraft: boolean;
  /** Each host passes ITS cf helper (one component, two hosts). */
  cf: CfFetch;
  /** Honest-absence inputs — disabled trigger kinds render their reason. */
  connected: TriggerConnectivity;
  /** The agent's goal — steers the deterministic draft briefs. */
  goal: string | null;
  /** Fired right after the POST succeeds (before the done screen closes). */
  onCreated: (created: SubcampaignCreated) => void;
  /** Wizard "✦ Suggest more branches": open pre-filled at the build step. */
  prefill?: { name: string; trigger: CampaignRuleTrigger } | null;
}

const label11: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 7 };
const reviewRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "12px 15px" };
const reviewLabel: React.CSSProperties = { fontSize: 12.5, color: "#9AA59E", flex: 1 };
const reviewValue: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#0E1512", textAlign: "right" };

/** The trigger dropdown's option list. DISABLED kinds render at opacity .55
 *  with their reason line and take NO click handler — honest absence, never
 *  a dead pick. Exported so the option anatomy is testable in isolation. */
export function TriggerMenu({
  connected,
  selected,
  onPick,
}: {
  connected: TriggerConnectivity;
  selected: CampaignRuleTriggerKind | null;
  onPick: (kind: CampaignRuleTriggerKind) => void;
}) {
  const [hoverKind, setHoverKind] = useState<CampaignRuleTriggerKind | null>(null);
  return (
    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 36px rgba(14,21,18,.18)", maxHeight: 230, overflowY: "auto", zIndex: 5 }} data-testid="subnew-trigger-menu">
      {TRIGGER_OPTIONS.map((o) => {
        const avail = triggerAvailability(o.kind, connected);
        return (
          <div
            key={o.kind}
            onClick={avail.enabled ? () => onPick(o.kind) : undefined}
            onMouseEnter={() => setHoverKind(o.kind)}
            onMouseLeave={() => setHoverKind(null)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", fontSize: 13.5, cursor: avail.enabled ? "pointer" : "default", opacity: avail.enabled ? 1 : 0.55, background: avail.enabled && hoverKind === o.kind ? "#FBF7F0" : "#fff" }}
            data-testid={`subnew-trigger-option-${o.kind}`}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, color: "#0E1512" }}>{o.label}</span>
              {/* honest absence — the reason renders, the pick doesn't */}
              {!avail.enabled && avail.reason ? (
                <span style={{ display: "block", fontSize: 11, color: "#9AA59E" }}>{avail.reason}</span>
              ) : null}
            </span>
            {selected === o.kind ? <span style={{ color: "#16A82A", flex: "none" }}>✓</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function SubcampaignCreator(props: SubcampaignCreatorProps) {
  const { open, onClose, agentId, isDraft, cf, connected, goal, onCreated, prefill } = props;
  const [step, setStep] = useState(0); // 0 trigger · 1 method · 2 review · 3 done
  const [kind, setKind] = useState<CampaignRuleTriggerKind | null>(null);
  const [intents, setIntents] = useState<string[]>([]);
  const [quietDays, setQuietDays] = useState(30);
  // INT W2: before_meeting's hours payload (schema 1..336; default a day).
  const [beforeHours, setBeforeHours] = useState(24);
  const [name, setName] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const [method, setMethod] = useState<"ai" | "scratch" | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftedStep[] | null>(null);
  const [draftFailed, setDraftFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The done screen outlives the form state — snapshot what it recaps.
  const [done, setDone] = useState<{ trigger: CampaignRuleTrigger; builtWithAI: boolean; stepCount: number } | null>(null);
  // Open/close fences the uncancellable compose fetches (the StepsTab epoch
  // pattern): a stale draft can never land in a reopened creator.
  const epochRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    epochRef.current += 1;
    setError(null);
    setBusy(false);
    setDraftBusy(false);
    setDrafts(null);
    setDraftFailed(false);
    setDropOpen(false);
    setMethod(null);
    setDone(null);
    if (prefill) {
      setName(prefill.name);
      setKind(prefill.trigger.kind);
      setIntents(prefill.trigger.kind === "reply_classified" ? [...prefill.trigger.intents] : []);
      setQuietDays(prefill.trigger.kind === "sequence_quiet" ? prefill.trigger.days : 30);
      setBeforeHours(prefill.trigger.kind === "before_meeting" ? prefill.trigger.hours : 24);
      setStep(1);
    } else {
      setName("");
      setKind(null);
      setIntents([]);
      setQuietDays(30);
      setBeforeHours(24);
      setStep(0);
    }
  }, [open, prefill]);

  if (!open) return null;

  const trigger: CampaignRuleTrigger | null =
    kind === null
      ? null
      : kind === "reply_classified"
        ? intents.length > 0
          ? { kind, intents }
          : null
        : kind === "sequence_quiet"
          ? { kind, days: quietDays }
          : kind === "before_meeting"
            ? { kind, hours: beforeHours }
            : { kind };

  const builtWithAI = drafts !== null && drafts.length > 0;
  const stepValid = step === 0 ? trigger !== null && name.trim().length > 0 : step === 1 ? method !== null : !busy;
  const primaryEnabled = stepValid && !draftBusy && !busy;

  async function continueFromMethod() {
    if (!trigger || draftBusy) return;
    if (method === "scratch") {
      setDrafts(null);
      setDraftFailed(false);
      setStep(2);
      return;
    }
    const epoch = epochRef.current;
    setDraftBusy(true);
    const res = await composeSubcampaignDraft(cf, agentId, deriveSubcampaignBriefs(trigger, name, goal));
    if (epochRef.current !== epoch) return; // creator closed/reopened — drop the stale draft
    if (res.ok) {
      setDrafts(res.steps);
      setDraftFailed(false);
    } else {
      // Honest fallback — never canned copy presented as AI.
      setDrafts(null);
      setDraftFailed(true);
    }
    setDraftBusy(false);
    setStep(2);
  }

  async function create() {
    if (!trigger || busy) return;
    const epoch = epochRef.current;
    setBusy(true);
    setError(null);
    try {
      const res = (await cf("planner/subcampaign", {
        method: "POST",
        body: JSON.stringify(buildCreateBody(agentId, name, trigger, drafts)),
      })) as { graph: CampaignGraph; version: number; source?: string; subcampaignId: string; ruleId: string };
      if (epochRef.current !== epoch) return;
      onCreated({
        graph: res.graph,
        version: res.version,
        source: res.source ?? "MANUAL",
        subcampaignId: res.subcampaignId,
        ruleId: res.ruleId,
        trigger,
        builtWithAI,
      });
      setDone({ trigger, builtWithAI, stepCount: drafts?.length ?? 0 });
      setStep(3);
    } catch (err) {
      // 422/409 detail renders verbatim (#88 precedent — never a stuck busy state).
      if (epochRef.current === epoch) {
        setError(err instanceof CfError && err.detail ? err.detail : err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (epochRef.current === epoch) setBusy(false);
    }
  }

  const primaryLabel =
    step === 2 ? (busy ? "Creating…" : "Create sub-campaign") : draftBusy ? "Drafting…" : "Continue";
  const onPrimary =
    step === 0
      ? () => setStep(1)
      : step === 1
        ? () => void continueFromMethod()
        : () => void create();

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", zIndex: 60, fontFamily: "'Hanken Grotesk',sans-serif" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 520, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,0,.32)" }} data-testid="subnew-modal">
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px 14px" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: GRAD, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, flex: "none" }}>⎇</span>
          <span style={{ flex: 1, fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512" }}>New sub-campaign</span>
          <span onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
        </div>

        {/* progress — 3 segments + STEP N OF 3 (hidden on the done screen) */}
        {step < 3 ? (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ flex: 1, height: 5, borderRadius: 100, background: i <= step ? "#16A82A" : "#E4EAE6" }} />
              ))}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 8 }}>Step {step + 1} of 3</div>
          </div>
        ) : null}

        {/* DEC-076: the honest versioning line on a launched agent (same
            anatomy as StepEditorDrawer's liveNotice block) */}
        {!isDraft ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#5C6B62", background: "#FBF7F0", borderTop: "1px solid #EBE3D6", borderBottom: "1px solid #EBE3D6", padding: "10px 20px" }} data-testid="subnew-live-notice">
            <span style={{ flex: "none" }}>⏱</span>
            <span>{LIVE_GRAPH_NOTICE}</span>
          </div>
        ) : null}

        {step === 0 ? (
          <div style={{ padding: "14px 20px 18px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512" }}>When should contacts enter this branch?</div>
            <div style={{ fontSize: 13, color: "#9AA59E", marginTop: 3 }}>Pick the behaviour that moves a contact into this sub-campaign.</div>

            <label style={{ ...label11, marginTop: 18 }}>Trigger</label>
            <div style={{ position: "relative" }}>
              <div onClick={() => setDropOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "12px 14px", fontSize: 13.5, cursor: "pointer" }} data-testid="subnew-trigger-select">
                <span style={{ flex: 1, color: kind ? "#0E1512" : "#B7BDB6", fontWeight: kind ? 600 : 400 }}>
                  {kind ? triggerLabel(kind) : "Select a trigger…"}
                </span>
                <span style={{ color: "#9AA59E", flex: "none" }}>⌄</span>
              </div>
              {dropOpen ? (
                <TriggerMenu
                  connected={connected}
                  selected={kind}
                  onPick={(k) => {
                    setKind(k);
                    setDropOpen(false);
                  }}
                />
              ) : null}
            </div>

            {kind === "reply_classified" ? (
              <div style={{ marginTop: 14 }}>
                <label style={label11}>Intents</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }} data-testid="subnew-intents">
                  {REPLY_INTENT_OPTIONS.map((i) => {
                    const tint = intentTint(i);
                    const on = intents.includes(i);
                    return (
                      <span
                        key={i}
                        onClick={() => setIntents((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
                        style={{ fontSize: 12, fontWeight: 700, borderRadius: 100, padding: "5px 12px", cursor: "pointer", background: on ? tint.bg : "#fff", color: on ? tint.fg : "#5C6B62", border: on ? "1px solid transparent" : "1px solid #EBE3D6" }}
                        data-testid={`subnew-intent-${i}`}
                      >
                        {tint.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {kind === "sequence_quiet" ? (
              <div style={{ marginTop: 14 }}>
                <label style={label11}>Days of quiet</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={quietDays}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setQuietDays(Number.isNaN(v) ? 30 : Math.min(365, Math.max(1, v)));
                  }}
                  style={{ width: 110, boxSizing: "border-box", borderRadius: 9, background: "#fff", border: "1px solid #EBE3D6", padding: "9px 12px", fontSize: 13.5, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }}
                  data-testid="subnew-quiet-days"
                />
              </div>
            ) : null}

            {/* INT W2: before_meeting hours — the quiet-days input anatomy. */}
            {kind === "before_meeting" ? (
              <div style={{ marginTop: 14 }}>
                <label style={label11}>Hours before the meeting</label>
                <input
                  type="number"
                  min={1}
                  max={336}
                  value={beforeHours}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setBeforeHours(Number.isNaN(v) ? 24 : Math.min(336, Math.max(1, v)));
                  }}
                  style={{ width: 110, boxSizing: "border-box", borderRadius: 9, background: "#fff", border: "1px solid #EBE3D6", padding: "9px 12px", fontSize: 13.5, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }}
                  data-testid="subnew-before-hours"
                />
              </div>
            ) : null}

            <label style={{ ...label11, marginTop: 16 }}>Name</label>
            <input
              value={name}
              maxLength={SUBCAMPAIGN_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="Interested follow-up"
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "12px 14px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }}
              data-testid="subnew-name"
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ padding: "14px 20px 18px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512" }}>How should we build it?</div>
            <div style={{ fontSize: 13, color: "#9AA59E", marginTop: 3 }}>AI can draft the whole branch, or you can build it yourself.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              {(
                [
                  { key: "ai" as const, icon: "✦", iconBg: "rgba(53,232,52,.16)", iconFg: "#16A82A", title: "Let AI draft it", sub: "Generates a sequence tuned to the trigger & your goal.", chip: "Recommended", tid: "subnew-pick-ai" },
                  { key: "scratch" as const, icon: "✎", iconBg: "#F2EEE4", iconFg: "#5C6B62", title: "Build from scratch", sub: "Start empty and add each step yourself.", chip: null, tid: "subnew-pick-scratch" },
                ]
              ).map((o) => {
                const on = method === o.key;
                return (
                  <div key={o.key} onClick={() => setMethod(o.key)} style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 13, padding: "15px 16px", cursor: "pointer", background: on ? "rgba(53,232,52,.05)" : "#fff", border: on ? "2px solid #35E834" : "1px solid #EBE3D6" }} data-testid={o.tid}>
                    <span style={{ width: 38, height: 38, borderRadius: 11, background: o.iconBg, color: o.iconFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, flex: "none" }}>{o.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: "#0E1512" }}>{o.title}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#8A7F6B", marginTop: 2 }}>{o.sub}</span>
                    </span>
                    {o.chip ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "2px 8px", flex: "none" }}>{o.chip}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 2 && trigger ? (
          <div style={{ padding: "14px 20px 18px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512" }}>Review &amp; create</div>
            <div style={{ fontSize: 13, color: "#9AA59E", marginTop: 3 }}>Confirm the branch setup — you can edit everything afterwards.</div>
            <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 13, marginTop: 14, overflow: "hidden" }} data-testid="subnew-review">
              <div style={reviewRow}>
                <span style={reviewLabel}>Name</span>
                <span style={reviewValue}>{name.trim()}</span>
              </div>
              <div style={{ ...reviewRow, borderTop: "1px solid #EBE3D6" }}>
                <span style={reviewLabel}>Trigger</span>
                <span style={reviewValue}>{triggerChip(trigger)}</span>
              </div>
              <div style={{ ...reviewRow, borderTop: "1px solid #EBE3D6" }}>
                <span style={reviewLabel}>Built with</span>
                <span style={{ ...reviewValue, color: "#16A82A" }}>{builtWithAI ? "AI-drafted sequence" : "Build from scratch"}</span>
              </div>
            </div>
            {draftFailed ? (
              /* Honest fallback — the compose failed/refused; nothing is faked. */
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#9A6B12", background: "rgba(232,196,91,.1)", border: "1px solid rgba(232,196,91,.4)", borderRadius: 11, padding: "10px 14px", marginTop: 10 }} data-testid="subnew-draft-fallback">
                <span style={{ flex: "none" }}>✎</span>
                <span>{AI_DRAFT_FALLBACK}</span>
              </div>
            ) : null}
            {/* Drafted-step preview rows — DESIGNED ADDITION (honest-AI
                provenance, owner lock 2026-07-14): every AI-drafted value
                renders ✦-marked (the SeedChip convention) until the owner
                edits it in the sequence editor after creation. */}
            {drafts
              ? drafts.map((d, i) => (
                  <div key={i} style={{ border: "1px solid rgba(54,215,237,.55)", background: "rgba(54,215,237,.06)", borderRadius: 11, padding: "10px 14px", marginTop: i === 0 ? 12 : 8 }} data-testid="subnew-draft-row">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: i === 0 ? "#0E1512" : "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {i === 0 ? d.subject : `Threaded follow-up · ${SUBCAMPAIGN_DRAFT_GAP_DAYS} days later`}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 100, padding: "2px 7px", flex: "none" }} data-testid="subnew-draft-chip">✦ AI-drafted</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.body}</div>
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {step === 3 && done ? (
          <div style={{ padding: "26px 20px 18px", textAlign: "center" }} data-testid="subnew-done">
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#D7F5DD", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto" }}>✓</div>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, color: "#0E1512", marginTop: 14 }}>Sub-campaign created</div>
            <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.55, marginTop: 6, maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
              {doneBodyCopy(done.builtWithAI, done.stepCount)}
            </div>
            <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 13, marginTop: 18, overflow: "hidden", textAlign: "left" }}>
              <div style={reviewRow}>
                <span style={reviewLabel}>Trigger</span>
                <span style={reviewValue}>{triggerChip(done.trigger)}</span>
              </div>
              <div style={{ ...reviewRow, borderTop: "1px solid #EBE3D6" }}>
                <span style={reviewLabel}>Built with</span>
                <span style={{ ...reviewValue, color: "#16A82A" }}>{done.builtWithAI ? "AI-drafted sequence" : "Build from scratch"}</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* 422/409 detail — verbatim, above the footer (#88 precedent) */}
        {error ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#C9543F", background: "rgba(224,121,107,.07)", borderTop: "1px solid rgba(224,121,107,.35)", padding: "9px 20px" }} data-testid="subnew-error">
            <span style={{ flex: "none" }}>⚠</span>
            <span>{error}</span>
          </div>
        ) : null}

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px 18px", borderTop: "1px solid #EBE3D6" }}>
          {step < 3 ? (
            <span
              onClick={draftBusy || busy ? undefined : step === 0 ? onClose : () => setStep((s) => s - 1)}
              style={{ fontSize: 13.5, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: draftBusy || busy ? "default" : "pointer" }}
              data-testid="subnew-back"
            >
              {step === 0 ? "Cancel" : "‹ Back"}
            </span>
          ) : null}
          {step < 3 ? (
            <span
              onClick={primaryEnabled ? onPrimary : undefined}
              style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: primaryEnabled ? "#0A0F0C" : "#9AA59E", background: primaryEnabled ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 22px", cursor: primaryEnabled ? "pointer" : "default", boxShadow: primaryEnabled ? "0 6px 16px rgba(53,232,52,.26)" : "none" }}
              data-testid={step === 2 ? "subnew-create" : "subnew-continue"}
            >
              {primaryLabel}
            </span>
          ) : (
            <span onClick={onClose} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="subnew-done-close">
              Done
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
