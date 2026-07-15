/**
 * Sequence-editor shared atoms (W3-4, DEC-076). Canonical home for the
 * pieces BOTH hosts (Create Agent wizard step 2 · agent-view Steps tab) use;
 * `app/agents/new/shared.tsx` re-exports them so every pre-W3-4 wizard import
 * keeps resolving. One definition, two hosts — never a fork.
 */

export const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

/**
 * W2 (#94): typed `cf` failure. The API's owner-readable `detail`/`message`
 * rides the error object (the sub-campaign creator renders a 422's detail
 * verbatim — the #88 error-handling precedent, never a stuck busy state);
 * `message` stays exactly `path: status` so every existing sink and matcher
 * (toasts, ensureImportList's 409 regex) is untouched. ONE class here — both
 * hosts' cf helpers throw it, so `instanceof` holds across the shared
 * components regardless of which host's cf a prop carries.
 */
export class CfError extends Error {
  constructor(
    path: string,
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(`${path}: ${status}`);
    this.name = "CfError";
  }
}

/** G1/G2 brief-editor draft (channel-aware — email adds subjectHint). */
export type BriefDraft = {
  channel: "email" | "sms";
  objective: string;
  subjectHint: string;
  talkingPoints: string[];
  mustSay: string[];
  neverSay: string[];
};

/** G1/G2 sample-preview display states (refusal is a designed state). */
export type PreviewState =
  | { kind: "composed"; subject?: string; body: string; credits: number }
  | { kind: "refused"; reason: string; detail: string }
  | { kind: "error"; message: string };

/**
 * DEC-076 versioning notice — the one honest sentence every live-graph edit
 * surface renders (owner-locked copy, 2026-07-14).
 */
export const LIVE_GRAPH_NOTICE =
  "Changes apply to new contacts and upcoming steps — contacts mid-sequence finish on the current version.";
