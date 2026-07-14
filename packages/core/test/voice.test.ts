/**
 * P3.1 (DEC-078) — voice constants + spoken-name resolution. Pure, no infra.
 *
 * The disclosure pins are this unit's compliance gate: the English named and
 * default renders are BYTE-EQUAL to the owner-locked literals (2026-07-14),
 * the recording sentence renders only when the workspace flag is ON (default
 * OFF), and every launch language carries every disclosure segment with the
 * substitution tokens intact. The resolution fixtures pin the locked chain:
 * agent confirmed → workspace default → default literal.
 */
import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_STRINGS,
  DEFAULT_VOICE_PERSONA_ID,
  guardrailsSchema,
  isValidSpokenName,
  LAUNCH_LANGUAGES,
  parseWorkspaceVoiceDefaults,
  renderVoiceDisclosure,
  resolveSpokenName,
  spokenNameIssue,
  VOICE_PERSONAS,
  VOICE_RECORDING_DEFAULT_ENABLED,
  VOICE_RECORDING_RETENTION_MONTHS,
  voicePersonaById,
} from "../src";

// ── The owner-locked literals (2026-07-14) — restated verbatim ──────────────
const LOCKED_NAMED =
  "Hi, this is Ava, an AI assistant calling on behalf of Acme Dental. " +
  "This call may be recorded for quality. Is now a quick moment?";
const LOCKED_DEFAULT =
  "Hi, this is an AI assistant calling on behalf of Acme Dental. " +
  "This call may be recorded for quality. Is now a quick moment?";

describe("renderVoiceDisclosure — the locked literals, byte-equal", () => {
  it("named variant (recording ON) matches the owner-locked literal exactly", () => {
    expect(
      renderVoiceDisclosure({
        spokenName: "Ava",
        businessName: "Acme Dental",
        recordingEnabled: true,
      }),
    ).toBe(LOCKED_NAMED);
  });

  it("default variant (recording ON) matches the owner-locked literal exactly", () => {
    expect(
      renderVoiceDisclosure({
        spokenName: null,
        businessName: "Acme Dental",
        recordingEnabled: true,
      }),
    ).toBe(LOCKED_DEFAULT);
  });

  it("recording OFF drops ONLY the recording sentence (the certification branch)", () => {
    expect(
      renderVoiceDisclosure({ spokenName: "Ava", businessName: "Acme Dental" }),
    ).toBe("Hi, this is Ava, an AI assistant calling on behalf of Acme Dental. Is now a quick moment?");
    expect(
      renderVoiceDisclosure({ spokenName: null, businessName: "Acme Dental" }),
    ).toBe("Hi, this is an AI assistant calling on behalf of Acme Dental. Is now a quick moment?");
  });

  it("recording defaults OFF (the owner-locked default)", () => {
    expect(VOICE_RECORDING_DEFAULT_ENABLED).toBe(false);
    expect(renderVoiceDisclosure({ spokenName: null, businessName: "X" })).not.toContain(
      "recorded",
    );
  });

  it("renders in the agent's language from the pre-translated map (never AI)", () => {
    const es = renderVoiceDisclosure({
      language: "es",
      spokenName: "Ava",
      businessName: "Acme Dental",
      recordingEnabled: true,
    });
    expect(es).toBe(
      "Hola, soy Ava, un asistente de IA que llama en nombre de Acme Dental. " +
        "Esta llamada puede ser grabada por motivos de calidad. ¿Es un buen momento?",
    );
  });
});

describe("COMPLIANCE_STRINGS — voice disclosure completeness (all launch languages)", () => {
  for (const code of LAUNCH_LANGUAGES) {
    it(`${code}: carries every segment with the substitution tokens intact`, () => {
      const s = COMPLIANCE_STRINGS[code];
      expect(s.voiceDisclosureNamed).toContain("{spokenName}");
      expect(s.voiceDisclosureNamed).toContain("{businessName}");
      expect(s.voiceDisclosureDefault).toContain("{businessName}");
      expect(s.voiceDisclosureDefault).not.toContain("{spokenName}");
      expect(s.voiceRecordingNotice.trim().length).toBeGreaterThan(0);
      expect(s.voiceDisclosureClose.trim().length).toBeGreaterThan(0);
    });
  }
});

describe("resolveSpokenName — the locked chain (agent confirmed → workspace → default)", () => {
  const ws = { spokenName: "Sam" };

  it("agent CONFIRMED name wins", () => {
    expect(resolveSpokenName({ spokenName: "Ava", spokenNameConfirmed: true }, ws)).toEqual({
      spokenName: "Ava",
      source: "agent",
    });
  });

  it("an UNCONFIRMED agent name (the ✦ suggestion) falls through to the workspace default", () => {
    expect(resolveSpokenName({ spokenName: "Ava", spokenNameConfirmed: false }, ws)).toEqual({
      spokenName: "Sam",
      source: "workspace",
    });
    expect(resolveSpokenName({ spokenName: "Ava" }, ws)).toEqual({
      spokenName: "Sam",
      source: "workspace",
    });
  });

  it("no agent rider at all → workspace default", () => {
    expect(resolveSpokenName(null, ws)).toEqual({ spokenName: "Sam", source: "workspace" });
    expect(resolveSpokenName(undefined, ws)).toEqual({ spokenName: "Sam", source: "workspace" });
  });

  it("nothing captured anywhere → the default literal (null)", () => {
    expect(resolveSpokenName(null, null)).toEqual({ spokenName: null, source: "default" });
    expect(resolveSpokenName({}, {})).toEqual({ spokenName: null, source: "default" });
  });

  it("an INVALID value never resolves — even confirmed (the disclosure never speaks an unvalidated string)", () => {
    expect(
      resolveSpokenName({ spokenName: "Dr. Smith", spokenNameConfirmed: true }, ws),
    ).toEqual({ spokenName: "Sam", source: "workspace" });
    expect(resolveSpokenName(null, { spokenName: "Officer Kelly" })).toEqual({
      spokenName: null,
      source: "default",
    });
  });
});

describe("spokenNameIssue — plain given names only", () => {
  it("accepts plain given names", () => {
    for (const name of ["Ava", "Mary Jane", "Jean-Luc", "O'Brien", "Zoë", "José"]) {
      expect(spokenNameIssue(name), name).toBeNull();
      expect(isValidSpokenName(name), name).toBe(true);
    }
  });

  it("rejects titles and professional claims", () => {
    for (const name of ["Dr. Smith", "Doctor Smith", "Professor X", "Officer Kelly", "Attorney Ray", "Nurse Joy", "Mr Jones"]) {
      expect(spokenNameIssue(name), name).toBe("TITLE_OR_CLAIM");
    }
  });

  it("rejects empties, digits, over-long and multi-word strings", () => {
    expect(spokenNameIssue("")).toBe("EMPTY");
    expect(spokenNameIssue("   ")).toBe("EMPTY");
    expect(spokenNameIssue("R2D2")).toBe("INVALID_CHARS");
    expect(spokenNameIssue("Anna Maria Luisa")).toBe("TOO_MANY_WORDS");
    expect(spokenNameIssue("A".repeat(41))).toBe("TOO_LONG");
  });
});

describe("settings shapes", () => {
  it("guardrails accept the voice rider + voice daily cap; legacy rows parse unchanged", () => {
    const legacy = {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200 },
      consent: null,
      unsubscribeFooter: true,
      suppressionCheck: true,
    };
    expect(() => guardrailsSchema.parse(legacy)).not.toThrow();
    const withVoice = guardrailsSchema.parse({
      ...legacy,
      dailyCap: { email: 200, voice: 20 },
      voice: { spokenName: "Ava", spokenNameConfirmed: true, voicePersonaId: "ava" },
    });
    expect(withVoice.voice?.spokenName).toBe("Ava");
    expect(withVoice.dailyCap.voice).toBe(20);
  });

  it("guardrails REJECT an invalid spoken name (a typo can't widen what gets spoken)", () => {
    const base = {
      sendingWindow: { days: [1], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200 },
      consent: null,
      unsubscribeFooter: true,
      suppressionCheck: true,
    };
    expect(() =>
      guardrailsSchema.parse({ ...base, voice: { spokenName: "Dr. Smith" } }),
    ).toThrow();
  });

  it("parseWorkspaceVoiceDefaults reads leniently — absent/invalid blocks are no defaults", () => {
    expect(parseWorkspaceVoiceDefaults(null)).toEqual({});
    expect(parseWorkspaceVoiceDefaults({})).toEqual({});
    expect(parseWorkspaceVoiceDefaults({ voiceDefaults: { spokenName: 42 } })).toEqual({});
    expect(
      parseWorkspaceVoiceDefaults({ voiceDefaults: { spokenName: "Sam", recordingEnabled: false } }),
    ).toEqual({ spokenName: "Sam", recordingEnabled: false });
  });
});

describe("personas", () => {
  it("the default persona is the prototype's literal (Ava — US English, warm → the ADR-proven voice)", () => {
    const ava = voicePersonaById(DEFAULT_VOICE_PERSONA_ID);
    expect(ava.label).toBe("Ava");
    expect(ava.descriptor).toBe("US English, warm");
    expect(ava.ttsModel).toBe("aura-2-thalia-en");
  });

  it("unknown/absent ids fall back to the default persona; every persona suggests its label as the ✦ name", () => {
    expect(voicePersonaById(undefined).id).toBe(DEFAULT_VOICE_PERSONA_ID);
    expect(voicePersonaById("nope").id).toBe(DEFAULT_VOICE_PERSONA_ID);
    for (const p of VOICE_PERSONAS) {
      expect(isValidSpokenName(p.label), p.id).toBe(true);
      expect(p.ttsModel).toMatch(/^aura-2-[a-z]+-en$/);
    }
  });

  it("retention constant is the locked 12 months", () => {
    expect(VOICE_RECORDING_RETENTION_MONTHS).toBe(12);
  });
});
