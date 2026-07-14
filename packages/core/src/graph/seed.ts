/**
 * Brief seeding for the scripted→guided per-step flip (W3-4 W2, DEC-076).
 * DETERMINISTIC derivation — the scripted step's own copy becomes the
 * editable seed (subject → subjectHint, body sentences → talking points,
 * the step's M1a arc role → objective). No model call happens here: the
 * one-step compose that proves the seed runs through the existing sandbox
 * composer (compose-preview with the staged brief), and every seeded value
 * renders ✦-marked in the editor until the owner edits or confirms it
 * (owner-locked provenance treatment, 2026-07-14). Never fake AI: this is
 * mechanical text derivation, labeled as such.
 */
import type { StepNode } from "./types";
import { BRIEF_SUBJECT_HINT_MAX, BRIEF_TALKING_POINTS_MIN, BRIEF_TALKING_POINTS_MAX } from "./validate";

export interface BriefSeedResult {
  objective: string;
  /** Email steps only — derived from the scripted subject. */
  subjectHint?: string;
  talkingPoints: string[];
  /** True when the seed already clears the brief floor (≥3 talking points). */
  complete: boolean;
}

/** The channels arc-role position mapping (`arcRoleFor`), mirrored: first
 *  step = opener, last = breakup, middle steps walk the interior roles. */
export function arcRoleAt(roles: readonly string[], index: number, count: number): string | undefined {
  if (roles.length === 0) return undefined;
  if (index <= 1) return roles[0];
  if (index >= count) return roles[roles.length - 1];
  return roles[Math.min(index - 1, Math.max(0, roles.length - 2))];
}

/** Merge tokens read as prose in a derived bullet — resolve them neutrally. */
function detokenize(text: string): string {
  return text
    .replace(/\{\{\s*custom\.[\w.]+\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{\s*firstName\s*\}\}/g, "the lead")
    .replace(/\{\{\s*lastName\s*\}\}/g, "")
    .replace(/\{\{\s*company\s*\}\}/g, "their company")
    .replace(/\{\{\s*senderName\s*\}\}/g, "you")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const NOISE_PREFIXES = [
  "hi", "hey", "hello", "dear", "thanks", "thank you", "best", "cheers",
  "regards", "warm regards", "talk soon", "ps", "p.s",
];

/**
 * Derive the editable brief seed from a scripted step's own copy. Purely
 * mechanical; `complete: false` means the owner must add talking points
 * before the brief can save (the editor's min-3 floor is the honest gate —
 * nothing is fabricated to fill the gap).
 */
export function deriveBriefSeed(step: StepNode, arcRole?: string): BriefSeedResult {
  const body = step.content.body ?? "";
  const sentences = body
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => detokenize(s))
    .map((s) => s.replace(/[\s—–-]+$/, "").trim())
    .filter((s) => s.length >= 10)
    .filter((s) => !NOISE_PREFIXES.some((p) => s.toLowerCase().startsWith(p)))
    .map((s) => (s.length > 200 ? `${s.slice(0, 199)}…` : s));
  const talkingPoints = [...new Set(sentences)].slice(0, BRIEF_TALKING_POINTS_MAX);

  const subject = detokenize(step.content.subject ?? "");
  const subjectHint =
    step.channel === "email" && subject
      ? subject.length > BRIEF_SUBJECT_HINT_MAX
        ? `${subject.slice(0, BRIEF_SUBJECT_HINT_MAX - 1)}…`
        : subject
      : undefined;

  const roleObjective = arcRole ? detokenize(arcRole) : "";
  const objective = (roleObjective || (subject ? `Get a reply about: ${subject}` : "Move this lead one step closer to the goal")).slice(0, 200);

  return {
    objective,
    ...(subjectHint ? { subjectHint } : {}),
    talkingPoints,
    complete: talkingPoints.length >= BRIEF_TALKING_POINTS_MIN,
  };
}
