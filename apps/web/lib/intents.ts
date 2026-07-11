/**
 * The ONE intent display vocabulary (M1b, DEC-068) — shared by the Inbox
 * chips, the wizard step-2 Branches view, and the Steps-tab branch pill, the
 * DEC-034 "one enum, never fork" rule extended to labels.
 *
 * Prototype vocabulary is preserved: `info_request` renders under the
 * prototype's "Question", `not_interested` under "Not interested" (each chip
 * filters its legacy twin together with the M1b value). "Price objection" /
 * "Not now" / "Wrong person" are designed labels with no prototype anchor —
 * flagged in DEC-068, composed from the chip anatomy verbatim.
 *
 * Unknown intent → the VERBATIM fallback (the C2.9 timeline rule): a value
 * this vocabulary doesn't know renders as itself in the neutral tint — never
 * a crash, never a silent drop. `null` stays "Unclassified".
 */

export interface IntentTint {
  fg: string;
  bg: string;
  label: string;
}

/** Per-intent chip treatment (thread rows, reading pane, timeline chips). */
export const INTENT_TINT: Record<string, IntentTint> = {
  interested: { fg: "#0F7A28", bg: "#D7F5DD", label: "Interested" },
  booked: { fg: "#1192A6", bg: "rgba(54,215,237,.16)", label: "Meeting booked" },
  replied: { fg: "#5C6B62", bg: "#F2EEE4", label: "Replied" },
  question: { fg: "#A87B16", bg: "rgba(232,196,91,.2)", label: "Question" },
  not: { fg: "#C9543F", bg: "rgba(224,121,107,.14)", label: "Not interested" },
  ooo: { fg: "#8A7F6B", bg: "#F2EEE4", label: "Auto-reply" },
  unsubscribe: { fg: "#C9543F", bg: "rgba(224,121,107,.14)", label: "Unsubscribed" },
  // ── M1b (DEC-068) strategy intents ─────────────────────────────────────────
  objection_price: { fg: "#6E7A12", bg: "rgba(208,245,107,.4)", label: "Price objection" },
  objection_timing: { fg: "#A87B16", bg: "rgba(232,196,91,.2)", label: "Not now" },
  wrong_person: { fg: "#5C6B62", bg: "#F2EEE4", label: "Wrong person" },
  info_request: { fg: "#A87B16", bg: "rgba(232,196,91,.2)", label: "Question" },
  not_interested: { fg: "#C9543F", bg: "rgba(224,121,107,.14)", label: "Not interested" },
};

/** Chip for an intent value — unknown values render VERBATIM in the neutral tint. */
export function intentTint(intent: string): IntentTint {
  return INTENT_TINT[intent] ?? { fg: "#5C6B62", bg: "#F2EEE4", label: intent };
}

/**
 * Inbox category chips. Each chip FILTERS a set of intents so a legacy thread
 * and its M1b twin land under one label. Order: the six strategy chips lead,
 * the bookkeeping chips (Replied fallback · Auto-reply) trail — "Replied"
 * moves behind Question/Not interested vs the prototype's relative order so
 * every strategy chip is on-screen at 1440 (deviation flagged in DEC-068;
 * the row stays horizontally scrollable per the prototype).
 */
export const INBOX_CATS: ReadonlyArray<{ id: string; label: string; intents: readonly string[] }> = [
  { id: "all", label: "All", intents: [] },
  { id: "interested", label: "Interested", intents: ["interested"] },
  { id: "booked", label: "Meeting booked", intents: ["booked"] },
  { id: "objection_price", label: "Price objection", intents: ["objection_price"] },
  { id: "objection_timing", label: "Not now", intents: ["objection_timing"] },
  { id: "wrong_person", label: "Wrong person", intents: ["wrong_person"] },
  { id: "question", label: "Question", intents: ["question", "info_request"] },
  { id: "not", label: "Not interested", intents: ["not", "not_interested"] },
  { id: "replied", label: "Replied", intents: ["replied"] },
  { id: "ooo", label: "Auto-reply", intents: ["ooo"] },
];

/** Branch-case "when" copy for the wizard/Steps views — verbatim fallback rule. */
export function branchWhenLabel(when: { intent: string } | "default"): string {
  if (when === "default") return "Any other reply";
  return `Reply classified “${intentTint(when.intent).label}”`;
}
