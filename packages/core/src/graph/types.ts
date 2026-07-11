/**
 * CampaignGraph — the planner's output contract (DATA_MODEL.md §3.1).
 *
 * A directed graph of typed nodes + conditional edges. The planner emits it, the
 * executor walks it. Tokens like `{{firstName}}` resolve per-lead at render time
 * (not this layer's concern). Intent is an opaque string here — the classifier's
 * `Intent` enum lives in `@clientforce/events`; keeping it loose lets core stay
 * dependency-light.
 */

export type NodeId = string;

export type Channel = "email" | "sms" | "whatsapp" | "voice" | "linkedin";
export type DelayUnit = "minutes" | "hours" | "days";
export type BranchOn = "reply" | "open" | "click" | "call_outcome" | "no_response";

export interface VoiceContent {
  persona?: string;
  objective?: string;
  script?: string;
}

/** Channel-step payload (permissive — channels use different fields). */
export interface StepContent {
  subject?: string;
  body?: string;
  template?: string;
  buttons?: string[];
  voice?: VoiceContent;
  /**
   * Email: this step continues the thread of the prior send (owner rule 3,
   * 2026-07-04). The ADAPTER enforces the semantics — In-Reply-To/References
   * to the prior providerMessageId, subject inherited; a "Re:"/"Fwd:" prefix
   * is only ever emitted on a real thread.
   */
  threaded?: boolean;
}

/**
 * G1 (DEC-070): a guided step's BRIEF — talking points, not finished copy.
 * The composer renders the real message per lead at send time; the planner
 * emits briefs only when the agent's `composeMode` is "guided".
 */
export interface StepBrief {
  /** What this step must achieve for the sequence (1–200 chars). */
  objective: string;
  /** 3–6 talking points the composed message draws from. */
  talkingPoints: string[];
  /** Strings that MUST appear verbatim in every composed message (≤5). */
  mustSay?: string[];
  /** Strings that must NEVER appear (≤10 — mirrors the M1a strategy caps). */
  neverSay?: string[];
}

/** A channel send. */
export interface StepNode {
  id: NodeId;
  type: "step";
  channel: Channel;
  content: StepContent;
  /**
   * G1 (DEC-070): absent = "scripted" — legacy graphs parse byte-identical.
   * "guided" steps carry a `brief` instead of body copy and are composed per
   * lead at send time; legal on channel "sms" ONLY this unit (email = G2).
   */
  mode?: "scripted" | "guided";
  /** Present exactly when `mode` is "guided". */
  brief?: StepBrief;
  /** Optional pipeline-stage move on send. */
  pipelineOnSend?: string;
}

/** A durable wait (Temporal timer at runtime). */
export interface DelayNode {
  id: NodeId;
  type: "delay";
  amount: number;
  unit: DelayUnit;
}

export type BranchWhen = { intent: string } | "default";

export interface BranchCase {
  when: BranchWhen;
  goto: NodeId;
  /** Optional pipeline-stage move when this case is taken. */
  pipeline?: string;
}

/** Waits on an event signal and routes by classified intent/condition. */
export interface BranchNode {
  id: NodeId;
  type: "branch";
  on: BranchOn;
  cases: BranchCase[];
}

/** Jump into a triggered sub-flow. */
export interface SubcampaignNode {
  id: NodeId;
  type: "subcampaign";
  ref: string;
}

/** Fire an agent tool / integration (e.g. send_proposal, book_meeting). */
export interface ActionNode {
  id: NodeId;
  type: "action";
  action: string;
  params?: Record<string, unknown>;
}

/** Terminal node. */
export interface EndNode {
  id: NodeId;
  type: "end";
}

export type GraphNode = StepNode | DelayNode | BranchNode | SubcampaignNode | ActionNode | EndNode;

export type GraphNodeType = GraphNode["type"];

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
}

export interface CampaignGraph {
  entry: NodeId;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The "intended actions" the executor emits — a log of what *would* happen if the
 * graph ran for real. No side effects.
 */
export type IntendedAction =
  | { kind: "send"; nodeId: NodeId; channel: Channel; content: StepContent }
  | { kind: "wait"; nodeId: NodeId; amount: number; unit: DelayUnit }
  | { kind: "pipeline_move"; nodeId: NodeId; stage: string }
  | { kind: "branch"; nodeId: NodeId; on: BranchOn; matched: string; goto: NodeId }
  | { kind: "action"; nodeId: NodeId; action: string; params?: Record<string, unknown> }
  | { kind: "enter_subcampaign"; nodeId: NodeId; ref: string }
  | { kind: "end"; nodeId: NodeId };
