/**
 * Voice constants + spoken-name resolution (P3.1, DEC-078).
 *
 * Owner-locked (2026-07-14):
 * - The opening disclosure is a DETERMINISTIC CONSTANT — spoken first on every
 *   outbound call, before any composed turn, never composed or AI-translated.
 *   Two literals; the runtime picks by whether a confirmed spoken name
 *   resolves. The "may be recorded" sentence renders ONLY when recording is ON
 *   for the workspace (default OFF).
 * - {spokenName} capture is two-moment (D0: never a wizard field): the Senders
 *   number flow seeds the workspace default; Agent Settings → Voice inherits
 *   it (rendered as inherited) with a per-agent override.
 * - Call-time resolution is the PURE FUNCTION below: agent confirmed name →
 *   workspace default → null (⇒ the default literal). Plain given names only —
 *   no titles/claims, never the agent's functional display name, never
 *   AI-generated at call time.
 * - Recording ships CONSTANTS ONLY this unit: the default-OFF flag, both
 *   disclosure branches, and the 12-month retention constant. The
 *   recording-ON machinery (admin toggle, purge job, region mute) is the
 *   follow-up unit.
 */
import { z } from "zod";
import { COMPLIANCE_STRINGS, DEFAULT_LANGUAGE, type LanguageCode } from "./language";

// ── Recording (constants only this unit — owner-locked) ─────────────────────
/** Per-workspace recording flag default. OFF ⇒ the disclosure renders the
 *  without-recording branch and no audio is ever stored. */
export const VOICE_RECORDING_DEFAULT_ENABLED = false;
/** Retention for call audio once recording is ON (future unit enforces the
 *  hard-purge job); the TRANSCRIPT persists past any purge as the
 *  operational record. */
export const VOICE_RECORDING_RETENTION_MONTHS = 12;

// ── TTS personas (Agent Settings → Voice picker) ─────────────────────────────
/**
 * Curated Deepgram Aura-2 personas. The default is the prototype's literal
 * "Ava — US English, warm" (Campaign View canon), mapped to the ADR-proven
 * spike voice. `suggestedSpokenName` is the ✦-suggested value shown until the
 * owner confirms or edits it (standard provenance rule) — a SUGGESTION only;
 * it never resolves at call time without confirmation.
 */
export interface VoicePersona {
  id: string;
  /** Display name — also the ✦-suggested spoken name. */
  label: string;
  /** Prototype-style descriptor, e.g. "US English, warm". */
  descriptor: string;
  /** Deepgram Aura-2 model id (all English — Q-023 tracks non-English voice). */
  ttsModel: string;
}

export const VOICE_PERSONAS: readonly VoicePersona[] = [
  { id: "ava", label: "Ava", descriptor: "US English, warm", ttsModel: "aura-2-thalia-en" },
  { id: "miles", label: "Miles", descriptor: "US English, confident", ttsModel: "aura-2-orion-en" },
  { id: "quinn", label: "Quinn", descriptor: "US English, calm", ttsModel: "aura-2-luna-en" },
  { id: "theo", label: "Theo", descriptor: "US English, friendly", ttsModel: "aura-2-arcas-en" },
] as const;

export const DEFAULT_VOICE_PERSONA_ID = "ava";

export const voicePersonaById = (id: string | null | undefined): VoicePersona =>
  VOICE_PERSONAS.find((p) => p.id === id) ??
  (VOICE_PERSONAS.find((p) => p.id === DEFAULT_VOICE_PERSONA_ID) as VoicePersona);

// ── Spoken-name validation (plain given name — no titles, no claims) ────────
/**
 * Tokens that turn a "name" into a title or professional claim an AI caller
 * must never make. Matched case-insensitively against whole words, including
 * dotted forms ("Dr." — punctuation is stripped before comparison).
 */
export const SPOKEN_NAME_BANNED_TOKENS: readonly string[] = [
  "dr",
  "doctor",
  "prof",
  "professor",
  "sir",
  "dame",
  "lord",
  "lady",
  "madam",
  "mr",
  "mrs",
  "ms",
  "mx",
  "rev",
  "reverend",
  "father",
  "pastor",
  "rabbi",
  "imam",
  "officer",
  "detective",
  "sergeant",
  "captain",
  "major",
  "colonel",
  "general",
  "judge",
  "attorney",
  "lawyer",
  "esq",
  "nurse",
  "agent",
  "president",
  "senator",
  "honorable",
] as const;

export const SPOKEN_NAME_MAX_LENGTH = 40;
/** At most two words — a given name, optionally a second (e.g. "Mary Jane"). */
export const SPOKEN_NAME_MAX_WORDS = 2;

const SPOKEN_NAME_WORD_RE = /^[\p{L}][\p{L}'’-]*$/u;

export type SpokenNameIssue = "EMPTY" | "TOO_LONG" | "TOO_MANY_WORDS" | "INVALID_CHARS" | "TITLE_OR_CLAIM";

/**
 * Validate a candidate spoken name: a plain given name (letters, apostrophes,
 * hyphens; ≤2 words; ≤40 chars) carrying no title or professional claim.
 * Returns null when valid, else the first issue found. Pure — UI and API use
 * the same verdict.
 */
export function spokenNameIssue(candidate: string): SpokenNameIssue | null {
  const trimmed = candidate.trim();
  if (trimmed === "") return "EMPTY";
  if (trimmed.length > SPOKEN_NAME_MAX_LENGTH) return "TOO_LONG";
  const words = trimmed.split(/\s+/);
  if (words.length > SPOKEN_NAME_MAX_WORDS) return "TOO_MANY_WORDS";
  for (const word of words) {
    const bare = word.replace(/[.,]/g, "");
    if (!SPOKEN_NAME_WORD_RE.test(bare)) return "INVALID_CHARS";
    if (SPOKEN_NAME_BANNED_TOKENS.includes(bare.toLowerCase())) return "TITLE_OR_CLAIM";
  }
  return null;
}

export const isValidSpokenName = (candidate: string): boolean => spokenNameIssue(candidate) === null;

/** Zod refinement shared by the guardrails rider and workspace defaults. */
export const spokenNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SPOKEN_NAME_MAX_LENGTH)
  .refine(isValidSpokenName, "spoken name must be a plain given name — no titles or claims");

// ── Settings shapes ──────────────────────────────────────────────────────────
/**
 * Agent-level voice rider on `Agent.guardrails` Json (goalLabel/strategy/
 * composeMode/language precedent — no migration; absent = defaults, legacy
 * rows parse unchanged). `spokenName` only resolves at call time when
 * `spokenNameConfirmed` is true — an unconfirmed value is the ✦ suggestion
 * surfaced in Settings, never spoken.
 */
export const voiceRiderSchema = z.object({
  spokenName: spokenNameSchema.optional(),
  spokenNameConfirmed: z.boolean().optional(),
  voicePersonaId: z.string().optional(),
});
export type VoiceRider = z.infer<typeof voiceRiderSchema>;

/**
 * Workspace-level voice defaults riding `Workspace.settings.voiceDefaults`
 * (untyped Json today — this is its typed contract). `spokenName` is seeded by
 * the Senders number-flow step; owner-entered there, so it counts as confirmed
 * by entry. `recordingEnabled` is the per-workspace recording flag (default
 * OFF — this unit ships the flag + disclosure branch only).
 */
export const workspaceVoiceDefaultsSchema = z.object({
  spokenName: spokenNameSchema.optional(),
  recordingEnabled: z.boolean().optional(),
});
export type WorkspaceVoiceDefaults = z.infer<typeof workspaceVoiceDefaultsSchema>;

/** Leniently read a workspace `settings` Json for voice defaults — an absent
 *  or unparsable block is "no defaults", never a throw (settings is untyped
 *  and shared with other features). */
export function parseWorkspaceVoiceDefaults(settings: unknown): WorkspaceVoiceDefaults {
  if (!settings || typeof settings !== "object") return {};
  const block = (settings as Record<string, unknown>).voiceDefaults;
  const parsed = workspaceVoiceDefaultsSchema.safeParse(block);
  return parsed.success ? parsed.data : {};
}

// ── Call-time resolution (PURE — owner-locked chain) ─────────────────────────
export type SpokenNameSource = "agent" | "workspace" | "default";

export interface ResolvedSpokenName {
  /** The name the disclosure speaks, or null ⇒ the default literal. */
  spokenName: string | null;
  source: SpokenNameSource;
}

/**
 * The locked resolution chain: agent CONFIRMED name → workspace default →
 * null (the "an AI assistant" default literal). Invalid or unconfirmed values
 * fall through — the disclosure never speaks an unvalidated string.
 */
export function resolveSpokenName(
  agentVoice: Pick<VoiceRider, "spokenName" | "spokenNameConfirmed"> | null | undefined,
  workspaceDefaults: Pick<WorkspaceVoiceDefaults, "spokenName"> | null | undefined,
): ResolvedSpokenName {
  const agentName = agentVoice?.spokenName?.trim();
  if (agentVoice?.spokenNameConfirmed === true && agentName && isValidSpokenName(agentName)) {
    return { spokenName: agentName, source: "agent" };
  }
  const wsName = workspaceDefaults?.spokenName?.trim();
  if (wsName && isValidSpokenName(wsName)) {
    return { spokenName: wsName, source: "workspace" };
  }
  return { spokenName: null, source: "default" };
}

// ── Disclosure rendering (deterministic — never composed) ────────────────────
export interface VoiceDisclosureInput {
  language?: LanguageCode;
  /** From `resolveSpokenName` — null picks the default literal. */
  spokenName: string | null;
  businessName: string;
  /** The workspace recording flag; default OFF drops the recording sentence. */
  recordingEnabled?: boolean;
}

/**
 * Render the locked opening disclosure. Pure string substitution over the
 * pre-translated compliance constants — the English named/default joins are
 * byte-equal to the owner-locked literals (pinned by test). This string is
 * spoken FIRST on every call, before any composed turn.
 */
export function renderVoiceDisclosure(input: VoiceDisclosureInput): string {
  const s = COMPLIANCE_STRINGS[input.language ?? DEFAULT_LANGUAGE];
  const intro = input.spokenName
    ? s.voiceDisclosureNamed.replace("{spokenName}", input.spokenName)
    : s.voiceDisclosureDefault;
  const parts = [
    intro.replace("{businessName}", input.businessName),
    ...(input.recordingEnabled ?? VOICE_RECORDING_DEFAULT_ENABLED ? [s.voiceRecordingNotice] : []),
    s.voiceDisclosureClose,
  ];
  return parts.join(" ");
}
