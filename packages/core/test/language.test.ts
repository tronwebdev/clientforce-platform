/**
 * L1 (DEC-072) — the language registry, the deterministic detector, and the
 * compliance-strings map. Pure, no infra.
 *
 * The completeness suite is the unit's compliance gate: every launch language
 * carries every compliance string, every SMS line names the literal keyword
 * STOP (the only keyword Twilio's rail actually honors), and the English
 * entries are byte-equal to the pre-L1 literals so English sends stay
 * wire-identical.
 */
import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_STRINGS,
  DEFAULT_GUARDRAILS,
  DEFAULT_LANGUAGE,
  detectLanguage,
  guardrailsSchema,
  LANGUAGE_DETECT_MIN_TOKENS,
  LANGUAGE_META,
  languagePromptLabel,
  LAUNCH_LANGUAGES,
  parseGuardrails,
  resolveLanguage,
  type LanguageCode,
} from "../src";

// ── Realistic per-language corpora (business copy, ~70 words each) ──────────
const CORPUS: Record<LanguageCode, string> = {
  en: "We help dental practices book more appointments and cut no-shows. Our software reminds your patients automatically and fills open slots within hours. More than two hundred practices already trust our solution across the country. Setup takes a single day and your team needs no training at all. Book a free consultation with our experts today and find out how much revenue you are losing to missed appointments every month.",
  es: "Ayudamos a las clínicas dentales a conseguir más citas y reducir las cancelaciones. Nuestro software recuerda automáticamente a sus pacientes y llena los huecos libres en pocas horas. Más de doscientas clínicas en España ya confían en nosotros. La puesta en marcha solo tarda un día y su equipo no necesita formación. Reserve hoy una consulta gratuita con nuestros expertos para descubrir cuántos ingresos está perdiendo cada mes.",
  fr: "Nous aidons les cabinets dentaires à obtenir plus de rendez-vous et à réduire les annulations. Notre logiciel rappelle automatiquement vos patients et remplit les créneaux libres en quelques heures. Plus de deux cents cabinets en France nous font déjà confiance. La mise en place ne prend qu'une journée et votre équipe n'a besoin d'aucune formation. Réservez dès aujourd'hui une consultation gratuite avec nos experts pour découvrir combien de chiffre d'affaires vous perdez chaque mois.",
  de: "Wir helfen Zahnarztpraxen dabei, mehr Termine zu buchen und weniger Ausfälle zu haben. Unsere Software erinnert Ihre Patienten automatisch und füllt freie Termine innerhalb weniger Stunden. Über zweihundert Praxen in Deutschland vertrauen bereits auf unsere Lösung. Die Einrichtung dauert nur einen Tag, und Ihr Team braucht keine Schulung. Vereinbaren Sie noch heute ein kostenloses Beratungsgespräch mit unseren Experten und erfahren Sie, wie viel Umsatz Sie durch verpasste Termine verlieren.",
  it: "Aiutiamo gli studi dentistici a ottenere più appuntamenti e a ridurre le cancellazioni. Il nostro software ricorda automaticamente ai pazienti gli appuntamenti e riempie gli spazi liberi in poche ore. Più di duecento studi in Italia si fidano già di noi. La configurazione richiede solo un giorno e il vostro team non ha bisogno di formazione. Prenotate oggi una consulenza gratuita con i nostri esperti per scoprire quanto fatturato state perdendo ogni mese.",
  pt: "Ajudamos clínicas dentárias a conseguir mais consultas e reduzir as faltas. O nosso software lembra automaticamente os seus pacientes e preenche os horários livres em poucas horas. Mais de duzentas clínicas em Portugal já confiam em nós. A configuração demora apenas um dia e a sua equipa não precisa de formação. Reserve hoje uma consulta gratuita com os nossos especialistas para descobrir quanta receita está a perder todos os meses.",
  nl: "Wij helpen tandartspraktijken aan meer afspraken en minder uitval. Onze software herinnert uw patiënten automatisch en vult vrije plekken binnen een paar uur. Meer dan tweehonderd praktijken in Nederland vertrouwen al op onze oplossing. De installatie duurt maar één dag en uw team heeft geen training nodig. Plan vandaag nog een gratis adviesgesprek met onze experts en ontdek hoeveel omzet u verliest door gemiste afspraken.",
  pl: "Pomagamy gabinetom stomatologicznym umawiać więcej wizyt i ograniczać nieobecności. Nasze oprogramowanie automatycznie przypomina pacjentom o wizytach i wypełnia wolne terminy w ciągu kilku godzin. Ponad dwieście gabinetów w Polsce już nam zaufało. Wdrożenie zajmuje tylko jeden dzień, a Twój zespół nie potrzebuje szkolenia. Umów się już dziś na bezpłatną konsultację z naszymi ekspertami i sprawdź, ile przychodu tracisz przez nieodwołane wizyty.",
};

describe("detectLanguage — confident on every launch language", () => {
  for (const code of LAUNCH_LANGUAGES) {
    it(`detects ${LANGUAGE_META[code].label} business copy as ${code}, confidently`, () => {
      const d = detectLanguage(CORPUS[code]);
      expect(d.code).toBe(code);
      expect(d.confident).toBe(true);
      expect(d.tokens).toBeGreaterThanOrEqual(LANGUAGE_DETECT_MIN_TOKENS);
    });
  }

  it("stays confident on German copy quoting an English proof point (dominance, not purity)", () => {
    const d = detectLanguage(
      `${CORPUS.de}\nEin Kunde schreibt: "120+ personalized proposals sent, zero manual work".`,
    );
    expect(d.code).toBe("de");
    expect(d.confident).toBe(true);
  });
});

describe("detectLanguage — the confidence gate (mixed/ambiguous → English default)", () => {
  it("a genuinely MIXED corpus (English site + German doc) is NOT confident", () => {
    const d = detectLanguage(`${CORPUS.en}\n\n${CORPUS.de}`);
    expect(d.confident).toBe(false);
  });

  it("a short/ambiguous corpus is NOT confident (below the token floor)", () => {
    const d = detectLanguage("Best dental care Berlin Zahnarzt appointment prices");
    expect(d.confident).toBe(false);
  });

  it("an empty corpus carries no signal at all", () => {
    const d = detectLanguage("");
    expect(d.code).toBeNull();
    expect(d.confident).toBe(false);
    expect(d.tokens).toBe(0);
  });

  it("marker-free noise (numbers, urls) is NOT confident", () => {
    const d = detectLanguage(
      "2026 2027 2028 https://example.com 15% 300mg item12 item13 item14 item15 item16 item17 item18 item19 item20 item21 item22 item23 item24 item25",
    );
    expect(d.confident).toBe(false);
  });

  it("is deterministic — same corpus, same result", () => {
    expect(detectLanguage(CORPUS.fr)).toEqual(detectLanguage(CORPUS.fr));
  });
});

describe("COMPLIANCE_STRINGS — completeness (the vitest pin DEC-072 promises)", () => {
  it("covers EXACTLY the launch language list", () => {
    expect(Object.keys(COMPLIANCE_STRINGS).sort()).toEqual([...LAUNCH_LANGUAGES].sort());
  });

  it("every launch language carries every compliance string, non-empty", () => {
    for (const code of LAUNCH_LANGUAGES) {
      const s = COMPLIANCE_STRINGS[code];
      expect(s.unsubscribeLabel.trim().length, `${code} unsubscribeLabel`).toBeGreaterThan(0);
      expect(s.smsOptOut.trim().length, `${code} smsOptOut`).toBeGreaterThan(0);
    }
  });

  it('every SMS opt-out line names the literal keyword "STOP" (the only keyword the Twilio rail honors)', () => {
    for (const code of LAUNCH_LANGUAGES) {
      expect(COMPLIANCE_STRINGS[code].smsOptOut, code).toContain("STOP");
    }
  });

  it("English entries are byte-equal to the pre-L1 literals (English sends stay wire-identical)", () => {
    expect(COMPLIANCE_STRINGS.en.unsubscribeLabel).toBe("Unsubscribe");
    expect(COMPLIANCE_STRINGS.en.smsOptOut).toBe("Reply STOP to opt out.");
  });

  it("every language has Settings metadata and a prompt label", () => {
    for (const code of LAUNCH_LANGUAGES) {
      expect(LANGUAGE_META[code].label.length).toBeGreaterThan(0);
      expect(LANGUAGE_META[code].native.length).toBeGreaterThan(0);
      expect(languagePromptLabel(code).length).toBeGreaterThan(0);
    }
    expect(languagePromptLabel("en")).toBe("English");
    expect(languagePromptLabel("de")).toBe("German (Deutsch)");
  });
});

describe("guardrails language rider (DEC-072 — goalLabel precedent, no migration)", () => {
  const base = {
    sendingWindow: { days: [1, 2, 3], start: "09:00", end: "17:00", timezone: "UTC" },
    dailyCap: { email: 100 },
    consent: null,
    unsubscribeFooter: true,
    suppressionCheck: true,
  };

  it("absent language = English — legacy rows parse unchanged", () => {
    const g = guardrailsSchema.parse(base);
    expect(g.language).toBeUndefined();
    expect(resolveLanguage(g)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(null)).toBe("en");
    expect(resolveLanguage(undefined)).toBe("en");
    // The conservative defaults never grew a language key.
    expect(DEFAULT_GUARDRAILS).not.toHaveProperty("language");
  });

  it("a launch-list language parses, with its source", () => {
    const g = guardrailsSchema.parse({ ...base, language: "de", languageSource: "detected" });
    expect(g.language).toBe("de");
    expect(g.languageSource).toBe("detected");
    expect(resolveLanguage(g)).toBe("de");
  });

  it("a language OUTSIDE the launch list throws (present-yet-invalid, A8 discipline)", () => {
    expect(() => parseGuardrails({ ...base, language: "sv" })).toThrow();
    expect(() => parseGuardrails({ ...base, language: "de", languageSource: "wizard" })).toThrow();
  });
});
