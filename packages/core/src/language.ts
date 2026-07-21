/**
 * Agent output language (L1, DEC-072) — the curated launch-language registry,
 * the deterministic language detector, and the pre-translated compliance
 * strings the send boundaries render.
 *
 * Three rules the whole unit hangs on:
 * 1. The list is a CURATED constant set — adding a language is a code change
 *    that must also extend COMPLIANCE_STRINGS (the completeness test pins
 *    every launch language × every compliance string).
 * 2. Detection is DETERMINISTIC (stopword + diacritic scoring, no model in
 *    the loop) and confidence-gated: mixed or ambiguous evidence → not
 *    confident → English default. Fixtures can pin it exactly.
 * 3. Compliance strings are NEVER AI-generated at send: the boundary picks a
 *    pre-translated constant by the agent's language. Every SMS opt-out line
 *    keeps the literal keyword "STOP" — Twilio's opt-out keywords are
 *    English, so a localized line must still name the keyword that actually
 *    triggers the rail (DEC-062/DEC-067).
 */
import { z } from "zod";

// ── The launch list (owner-approved on the PR #83 plan comment) ─────────────
export const LAUNCH_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "nl", "pl"] as const;
export const languageCodeSchema = z.enum(LAUNCH_LANGUAGES);
export type LanguageCode = z.infer<typeof languageCodeSchema>;

export const DEFAULT_LANGUAGE: LanguageCode = "en";

/** Who set the agent's language — the detector may only overwrite itself. */
export const languageSourceSchema = z.enum(["detected", "owner"]);
export type LanguageSource = z.infer<typeof languageSourceSchema>;

export interface LanguageMeta {
  /** English name (prompts, logs). */
  label: string;
  /** Native name (Settings select — the owner may not read English names). */
  native: string;
}

export const LANGUAGE_META: Record<LanguageCode, LanguageMeta> = {
  en: { label: "English", native: "English" },
  es: { label: "Spanish", native: "Español" },
  fr: { label: "French", native: "Français" },
  de: { label: "German", native: "Deutsch" },
  it: { label: "Italian", native: "Italiano" },
  pt: { label: "Portuguese", native: "Português" },
  nl: { label: "Dutch", native: "Nederlands" },
  pl: { label: "Polish", native: "Polski" },
};

/** Prompt-facing name, e.g. `German (Deutsch)` — English label first so the
 *  model can't misread the directive, native second for unambiguity. */
export const languagePromptLabel = (code: LanguageCode): string =>
  code === "en" ? "English" : `${LANGUAGE_META[code].label} (${LANGUAGE_META[code].native})`;

/**
 * The effective language of a (leniently read) guardrails rider — absent =
 * English, so every pre-L1 agent behaves exactly as before.
 */
export const resolveLanguage = (
  rider: { language?: LanguageCode | null } | null | undefined,
): LanguageCode => rider?.language ?? DEFAULT_LANGUAGE;

// ── Compliance strings (deterministic — rendered at the send boundary) ──────
export interface ComplianceStrings {
  /** Email footer link label: `${unsubscribeLabel}: ${url}` (P1.5 owner rule 2). */
  unsubscribeLabel: string;
  /** The full SMS opt-out line appended to an enrollment's first outbound
   *  (P2.1 DEC-062). Must contain the literal keyword "STOP". */
  smsOptOut: string;
  /**
   * P3.1 (DEC-078, owner-locked 2026-07-14): the opening call disclosure —
   * spoken FIRST on every outbound call, before any composed turn, never
   * composed or AI-translated. Four segments so the recording sentence can
   * branch on the workspace flag; `renderVoiceDisclosure` (voice.ts) joins
   * them and the English join is byte-equal to the locked literals (pinned).
   * `{spokenName}`/`{businessName}` are substituted deterministically.
   */
  voiceDisclosureNamed: string;
  voiceDisclosureDefault: string;
  voiceRecordingNotice: string;
  voiceDisclosureClose: string;
}

export const COMPLIANCE_STRINGS: Record<LanguageCode, ComplianceStrings> = {
  // en values are byte-equal to the pre-L1 literals — English sends are
  // wire-identical (pinned by test).
  en: {
    unsubscribeLabel: "Unsubscribe",
    smsOptOut: "Reply STOP to opt out.",
    voiceDisclosureNamed:
      "Hi, this is {spokenName}, an AI assistant calling on behalf of {businessName}.",
    voiceDisclosureDefault: "Hi, this is an AI assistant calling on behalf of {businessName}.",
    voiceRecordingNotice: "This call may be recorded for quality.",
    voiceDisclosureClose: "Is now a quick moment?",
  },
  es: {
    unsubscribeLabel: "Cancelar suscripción",
    smsOptOut: "Responde STOP para darte de baja.",
    voiceDisclosureNamed:
      "Hola, soy {spokenName}, un asistente de IA que llama en nombre de {businessName}.",
    voiceDisclosureDefault: "Hola, soy un asistente de IA que llama en nombre de {businessName}.",
    voiceRecordingNotice: "Esta llamada puede ser grabada por motivos de calidad.",
    voiceDisclosureClose: "¿Es un buen momento?",
  },
  fr: {
    unsubscribeLabel: "Se désinscrire",
    smsOptOut: "Répondez STOP pour vous désabonner.",
    voiceDisclosureNamed:
      "Bonjour, je suis {spokenName}, un assistant IA qui appelle de la part de {businessName}.",
    voiceDisclosureDefault:
      "Bonjour, je suis un assistant IA qui appelle de la part de {businessName}.",
    voiceRecordingNotice: "Cet appel peut être enregistré à des fins de qualité.",
    voiceDisclosureClose: "Est-ce un bon moment ?",
  },
  de: {
    unsubscribeLabel: "Abmelden",
    smsOptOut: "Antworten Sie mit STOP, um sich abzumelden.",
    voiceDisclosureNamed:
      "Hallo, hier ist {spokenName}, ein KI-Assistent, der im Auftrag von {businessName} anruft.",
    voiceDisclosureDefault:
      "Hallo, hier ist ein KI-Assistent, der im Auftrag von {businessName} anruft.",
    voiceRecordingNotice: "Dieses Gespräch kann zu Qualitätszwecken aufgezeichnet werden.",
    voiceDisclosureClose: "Passt es gerade kurz?",
  },
  it: {
    unsubscribeLabel: "Annulla l'iscrizione",
    smsOptOut: "Rispondi STOP per annullare l'iscrizione.",
    voiceDisclosureNamed:
      "Salve, sono {spokenName}, un assistente IA che chiama per conto di {businessName}.",
    voiceDisclosureDefault: "Salve, sono un assistente IA che chiama per conto di {businessName}.",
    voiceRecordingNotice: "Questa chiamata potrebbe essere registrata per motivi di qualità.",
    voiceDisclosureClose: "È un buon momento?",
  },
  pt: {
    unsubscribeLabel: "Cancelar inscrição",
    smsOptOut: "Responda STOP para cancelar.",
    voiceDisclosureNamed:
      "Olá, aqui é {spokenName}, um assistente de IA ligando em nome de {businessName}.",
    voiceDisclosureDefault: "Olá, aqui é um assistente de IA ligando em nome de {businessName}.",
    voiceRecordingNotice: "Esta chamada pode ser gravada para fins de qualidade.",
    voiceDisclosureClose: "É um bom momento?",
  },
  nl: {
    unsubscribeLabel: "Afmelden",
    smsOptOut: "Antwoord STOP om je af te melden.",
    voiceDisclosureNamed:
      "Hallo, u spreekt met {spokenName}, een AI-assistent die belt namens {businessName}.",
    voiceDisclosureDefault:
      "Hallo, u spreekt met een AI-assistent die belt namens {businessName}.",
    voiceRecordingNotice: "Dit gesprek kan worden opgenomen voor kwaliteitsdoeleinden.",
    voiceDisclosureClose: "Schikt het nu even?",
  },
  pl: {
    unsubscribeLabel: "Wypisz się",
    smsOptOut: "Odpowiedz STOP, aby się wypisać.",
    voiceDisclosureNamed:
      "Dzień dobry, mówi {spokenName}, asystent AI dzwoniący w imieniu {businessName}.",
    voiceDisclosureDefault: "Dzień dobry, mówi asystent AI dzwoniący w imieniu {businessName}.",
    voiceRecordingNotice: "Ta rozmowa może być nagrywana w celu zapewnienia jakości.",
    voiceDisclosureClose: "Czy to dobry moment?",
  },
};

// ── Deterministic detection ──────────────────────────────────────────────────
/** Below this many words the corpus can't support a confident call. */
export const LANGUAGE_DETECT_MIN_TOKENS = 24;
/** The winner must claim at least this marker density (hits / tokens). */
export const LANGUAGE_DETECT_MIN_SCORE = 0.08;
/** …and beat the runner-up by this relative margin, else MIXED → English. */
export const LANGUAGE_DETECT_MIN_MARGIN = 0.35;

/**
 * High-frequency function words per language. A word may appear in several
 * sets (siblings like es/pt genuinely share function words) — unique markers
 * dominate real text, and the relative-margin gate turns genuinely mixed
 * corpora into "not confident". Single letters are avoided except where they
 * are load-bearing and distinctive in context (pl w/z, it/pt e, es y).
 */
const MARKER_WORDS: Record<LanguageCode, readonly string[]> = {
  en: ["the", "and", "of", "to", "is", "that", "for", "with", "you", "your", "are", "this", "we", "our", "from", "have", "will", "can", "more", "about", "it", "be", "not", "they", "what"],
  es: ["y", "el", "los", "las", "es", "está", "son", "para", "con", "una", "del", "por", "más", "como", "pero", "sus", "muy", "nosotros", "usted", "también", "qué", "hay", "sin", "sobre", "nuestra"],
  fr: ["le", "la", "les", "des", "et", "est", "vous", "nous", "dans", "votre", "vos", "une", "qui", "pour", "sur", "pas", "être", "cette", "aux", "plus", "avec", "sont", "chez", "notre", "réponse"],
  de: ["der", "die", "das", "und", "ist", "nicht", "mit", "für", "wir", "sie", "eine", "ein", "auf", "werden", "haben", "sind", "auch", "dem", "den", "zur", "zum", "über", "können", "ihre", "ihr", "bei", "wie", "oder", "durch", "nach"],
  it: ["il", "lo", "gli", "e", "è", "di", "che", "per", "con", "una", "non", "più", "come", "anche", "sono", "della", "nella", "questo", "essere", "dei", "delle", "nel", "alla", "hanno", "molto"],
  pt: ["o", "os", "e", "é", "não", "com", "para", "uma", "mais", "como", "mas", "você", "são", "também", "já", "dos", "das", "pela", "pelo", "seu", "sua", "nossa", "sem", "até", "fazer"],
  nl: ["de", "het", "een", "en", "van", "voor", "met", "niet", "dat", "wij", "u", "uw", "aan", "op", "zijn", "naar", "ook", "onze", "kunnen", "worden", "bij", "wordt", "meer", "hoe", "geen"],
  pl: ["i", "w", "na", "z", "do", "nie", "jest", "się", "że", "dla", "jak", "ale", "oraz", "czy", "są", "aby", "przez", "może", "tylko", "nasze", "które", "być", "już", "pod", "bez"],
};

/**
 * Diacritics/characters that only (or overwhelmingly) occur in some of the
 * launch languages — a cheap, high-precision boost on top of word markers.
 */
const MARKER_CHARS: Partial<Record<LanguageCode, RegExp>> = {
  es: /[ñ¿¡]/g,
  fr: /[àâçèêëîïôûœ]/g,
  de: /[äöüß]/g,
  it: /[àèéìòù]/g,
  pt: /[ãõçâê]/g,
  pl: /[ąćęłńśźż]/g,
};
/** One diacritic hit counts as this fraction of a word-marker hit. */
const CHAR_MARKER_WEIGHT = 0.5;

export interface LanguageDetection {
  /** Best-scoring launch language, or null when the corpus carries no signal. */
  code: LanguageCode | null;
  /** True only when the corpus is long enough, the winner is dense enough,
   *  and the margin over the runner-up is clear. Not confident → callers
   *  fall back to English (the launch default). */
  confident: boolean;
  tokens: number;
  scores: Record<LanguageCode, number>;
}

const MARKER_SETS: Record<LanguageCode, Set<string>> = Object.fromEntries(
  (Object.entries(MARKER_WORDS) as [LanguageCode, readonly string[]][]).map(([code, words]) => [
    code,
    new Set(words),
  ]),
) as Record<LanguageCode, Set<string>>;

/** How much corpus the detector reads — plenty for dominance, bounded cost. */
export const LANGUAGE_DETECT_MAX_CHARS = 20_000;

/**
 * Detect the dominant launch language of a text corpus. Pure string work —
 * deterministic, so distill fixtures and the planner's language rail can pin
 * outcomes exactly. Mixed corpora (two languages both scoring high) fail the
 * margin gate on purpose: MIXED evidence means English default (DEC-072).
 */
export function detectLanguage(text: string): LanguageDetection {
  const corpus = text.slice(0, LANGUAGE_DETECT_MAX_CHARS).toLowerCase();
  const tokens = corpus.split(/[^\p{L}]+/u).filter(Boolean);
  const scores = Object.fromEntries(LAUNCH_LANGUAGES.map((c) => [c, 0])) as Record<
    LanguageCode,
    number
  >;

  if (tokens.length === 0) {
    return { code: null, confident: false, tokens: 0, scores };
  }

  for (const token of tokens) {
    for (const code of LAUNCH_LANGUAGES) {
      if (MARKER_SETS[code].has(token)) scores[code] += 1;
    }
  }
  for (const code of LAUNCH_LANGUAGES) {
    const re = MARKER_CHARS[code];
    if (re) scores[code] += (corpus.match(re)?.length ?? 0) * CHAR_MARKER_WEIGHT;
  }
  for (const code of LAUNCH_LANGUAGES) {
    scores[code] = scores[code] / tokens.length;
  }

  const ranked = [...LAUNCH_LANGUAGES].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0]!;
  const topScore = scores[top];
  const second = scores[ranked[1]!];

  const confident =
    tokens.length >= LANGUAGE_DETECT_MIN_TOKENS &&
    topScore >= LANGUAGE_DETECT_MIN_SCORE &&
    (topScore - second) / topScore >= LANGUAGE_DETECT_MIN_MARGIN;

  return { code: topScore > 0 ? top : null, confident, tokens: tokens.length, scores };
}
