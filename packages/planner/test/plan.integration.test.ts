/**
 * P1.4 acceptance integration: planning a seeded agent persists a validated
 * CampaignGraph v1 (source AI) on the primary campaign, the executor
 * round-trips it in dry-run, step copy is grounded in the stored
 * BusinessContext (DEC-015: ≥2 traceable facts) and carries the merge tokens;
 * broken model output is caught and never persisted. Requires Postgres;
 * completions are a prompt-parsing fake (no network). Skips without infra.
 *
 * M1a (DEC-065): the fake is PROMPT-DRIVEN like the original grounding
 * simulation — it emits the selling-craft arc shape only when the prompt
 * carries the v3 STRATEGY block, and honors the prompt's NEVER SAY list
 * (violating once/always per test mode). The structural assertions walk the
 * planned graph in flow order: opener word-cap + ends with its single
 * question, one CTA per step, strictly decreasing length, breakup last.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { execute, OPENER_WORD_CAP, type CampaignGraph, type StepNode } from "@clientforce/core";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { loadCampaignOutcomes } from "../src/outcomes";
import { planCampaign, PlannerError } from "../src/plan";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// The facts the fake planner lifts from the prompt's BUSINESS CONTEXT block —
// the DEC-015 assertion then traces them back to the stored BusinessContext.
const FACT_AUDIT = "free growth audit";
const FACT_PRICE = "99 dollars per booked appointment";
// L1 (DEC-072): the German workspace's own facts — German evidence distills
// to German values, so grounded German copy cites German strings.
const FACT_AUDIT_DE = "kostenloses Wachstums-Audit";
const FACT_PRICE_DE = "99 Euro pro gebuchtem Termin";

/** "good" emits a valid graph; "broken" emits a dangling branch goto. */
let mode: "good" | "broken" = "good";
/** M1a: whether the fake violates the prompt's NEVER SAY list. */
let banMode: "none" | "once" | "always" = "none";
/** L1: whether the fake IGNORES the prompt's OUTPUT LANGUAGE (emits English
 *  for a non-English agent) — "once" is repaired, "always" fails typed. */
let languageMode: "honor" | "once" | "always" = "honor";
let toolCalls = 0;
let lastPrompt = "";

/**
 * The pre-M1a fake shape, kept VERBATIM — what a planner without the playbook
 * produced. The structural before/after asserts this shape violates the arc.
 */
function legacyGraph(audit: string, price: string): object {
  return {
    entry: "step-1",
    nodes: [
      {
        id: "step-1",
        type: "step",
        channel: "email",
        content: {
          subject: `A ${audit} for {{company}}`,
          body: `Hi {{firstName}}, we run a ${audit} — pricing starts at ${price}. Worth a look for {{company}}?`,
        },
      },
      { id: "delay-1", type: "delay", amount: 3, unit: "days" },
      {
        id: "step-2",
        type: "step",
        channel: "email",
        content: {
          subject: "Following up",
          body: `Hi {{firstName}}, circling back on the ${audit}.`,
        },
      },
      {
        id: "branch-reply",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: mode === "broken" ? "nowhere" : "end-won" },
          { when: "default", goto: "end-lost" },
        ],
      },
      { id: "end-won", type: "end" },
      { id: "end-lost", type: "end" },
    ],
    edges: [
      { from: "step-1", to: "delay-1" },
      { from: "delay-1", to: "step-2" },
      { from: "step-2", to: "branch-reply" },
    ],
  };
}

/**
 * The arc-compliant shape a model following the v4 playbook emits: the M1a
 * selling-craft main sequence (opener ≤ cap ending with its one question,
 * value/proof, objection-preempt, breakup last — strictly decreasing, one CTA
 * each) PLUS the M1b six-case REPLY PLAYBOOK branch with its strategy steps
 * and stage pins. `dirty` appends a banned phrase (parsed from the prompt) to
 * the value step.
 */
function craftGraph(audit: string, price: string, dirty: string): object {
  return {
    entry: "step-1",
    nodes: [
      {
        id: "step-1",
        type: "step",
        channel: "email",
        content: {
          subject: "where bookings leak",
          body:
            `Noticed {{company}} still books most patients by phone — usually where no-shows creep in. ` +
            `We run a ${audit} that shows practices exactly where bookings leak, {{firstName}}. Worth a 15-minute look?`,
        },
      },
      { id: "delay-1", type: "delay", amount: 2, unit: "days" },
      {
        id: "step-2",
        type: "step",
        channel: "email",
        content: {
          subject: "the audit numbers",
          body: `One number from that ${audit}: ${price} — measured, not promised. Want the two-line summary for {{company}}, {{firstName}}?${dirty}`,
        },
      },
      {
        id: "branch-reply",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: mode === "broken" ? "nowhere" : "end-won", pipeline: "booked" },
          { when: { intent: "objection_price" }, goto: "step-reframe-price", pipeline: "replied" },
          { when: { intent: "objection_timing" }, goto: "step-ack-timing", pipeline: "replied" },
          { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
          { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
          { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
          { when: "default", goto: "step-3" },
        ],
      },
      {
        id: "step-3",
        type: "step",
        channel: "email",
        content: {
          subject: "one 20-minute call",
          body: `It's one 20-minute call, {{firstName}} — no prep, no commitment. Open to it?`,
        },
      },
      { id: "delay-2", type: "delay", amount: 4, unit: "days" },
      {
        id: "step-4",
        type: "step",
        channel: "email",
        content: {
          subject: "closing the file",
          body: `Closing the file on {{company}}, {{firstName}} — no worries either way.`,
        },
      },
      // M1b reply-strategy steps: price/answer rejoin the branch, timing waits
      // long then rejoins, wrong_person/not_interested close out.
      {
        id: "step-reframe-price",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `Fair concern, {{firstName}} — the ${audit} exists so you see the number before spending anything. Worth seeing it?`,
          threaded: true,
        },
      },
      {
        id: "step-ack-timing",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `Understood, {{firstName}} — I'll circle back when the timing fits {{company}}. Sound fair?`,
          threaded: true,
        },
      },
      { id: "delay-timing", type: "delay", amount: 30, unit: "days" },
      {
        id: "step-timing-follow",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `Circling back as promised, {{firstName}} — is now a better moment for {{company}}?`,
          threaded: true,
        },
      },
      {
        id: "step-referral",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `Thanks for the honesty, {{firstName}} — who at {{company}} should I speak with instead?`,
          threaded: true,
        },
      },
      {
        id: "step-answer",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `Good question, {{firstName}} — the ${audit} covers exactly that. Want the two-line summary?`,
          threaded: true,
        },
      },
      {
        id: "step-close",
        type: "step",
        channel: "email",
        content: {
          subject: "Re: the audit numbers",
          body: `All good, {{firstName}} — closing this out. If {{company}} ever wants the ${audit}, the door's open.`,
          threaded: true,
        },
      },
      { id: "end-won", type: "end" },
      { id: "end-lost", type: "end" },
    ],
    edges: [
      { from: "step-1", to: "delay-1" },
      { from: "delay-1", to: "step-2" },
      { from: "step-2", to: "branch-reply" },
      { from: "step-3", to: "delay-2" },
      { from: "delay-2", to: "step-4" },
      { from: "step-4", to: "end-lost" },
      { from: "step-reframe-price", to: "branch-reply" },
      { from: "step-ack-timing", to: "delay-timing" },
      { from: "delay-timing", to: "step-timing-follow" },
      { from: "step-timing-follow", to: "branch-reply" },
      { from: "step-referral", to: "end-lost" },
      { from: "step-answer", to: "branch-reply" },
      { from: "step-close", to: "end-lost" },
    ],
  };
}

/**
 * G2 (DEC-071): what a model following the v7 guided prompt emits — the v5
 * playbook shape VERBATIM (six-case branch + strategy steps) with EVERY
 * main-sequence step flipped to mode:"guided" carrying a BRIEF (grounded
 * talking points, no copy); email briefs also carry `subjectHint`, sms briefs
 * never do; reply-strategy steps stay fully scripted email. When the prompt
 * allows sms, step-2 is a guided SMS brief (both channels proven); an
 * email-only prompt keeps every step email. `dirtyBrief` plants a banned term
 * in a talking point (the neverSay scan covers brief text too). Derived from
 * craftGraph so the fake tracks the playbook shape by construction.
 */
function guidedGraph(audit: string, dirtyBrief: string, smsAllowed: boolean): object {
  const base = craftGraph(audit, "the audit pays for itself", "") as {
    nodes: Array<Record<string, unknown> & { id: string }>;
  };
  const MAIN = new Map<string, { objective: string; hintable: boolean }>([
    ["step-1", { objective: "Earn a reply about the audit", hintable: true }],
    ["step-2", { objective: "Earn a quick yes/no reply about the audit", hintable: true }],
    ["step-3", { objective: "Make the call feel effortless", hintable: true }],
    ["step-4", { objective: "Close the loop politely with an easy out", hintable: true }],
  ]);
  return {
    ...base,
    nodes: base.nodes.map((n) => {
      const main = MAIN.get(n.id);
      if (!main) return n;
      const channel = n.id === "step-2" && smsAllowed ? "sms" : "email";
      return {
        id: n.id,
        type: "step",
        channel,
        mode: "guided",
        content: {},
        brief: {
          objective: main.objective,
          talkingPoints: [
            `the ${audit} shows where bookings leak${n.id === "step-2" ? dirtyBrief : ""}`,
            "results land within 7 days",
            "no commitment to look",
          ],
          mustSay: [],
          neverSay: [],
          // v7: subjectHint on EMAIL briefs only.
          ...(channel === "email" ? { subjectHint: "where bookings leak" } : {}),
        },
      };
    }),
  };
}

/**
 * L1 (DEC-072): what a model following the v7 language prompt emits — the
 * craftGraph shape VERBATIM (ids, edges, six-case playbook, stage pins) with
 * every subject/body written in the agent's language. Machine identifiers and
 * merge tokens stay exactly as the prompt instructs. The audit/price facts
 * interpolate so grounding (DEC-015) still traces to the stored context.
 */
function localizedCraftGraph(lang: "de" | "fr", audit: string, price: string): object {
  const t =
    lang === "de"
      ? {
          s1subj: "wo Termine verloren gehen",
          s1body: `Mir ist aufgefallen, dass {{company}} die meisten Patienten noch telefonisch bucht — genau dort entstehen die Ausfälle. Unser ${audit} zeigt Praxen, wo Termine verloren gehen, {{firstName}}. Lohnt sich ein kurzer Blick für Sie?`,
          s2subj: "die Zahlen aus dem Audit",
          s2body: `Unser ${audit} liefert eine Zahl: ${price} — gemessen, nicht versprochen. Möchten Sie die Kurzfassung für {{company}}, {{firstName}}?`,
          s3subj: "ein Gespräch von 20 Minuten",
          s3body: `Es ist ein Gespräch von 20 Minuten, {{firstName}} — keine Vorbereitung, keine Verpflichtung. Wäre das etwas für Sie?`,
          s4subj: "ich schließe die Akte",
          s4body: `Ich schließe die Akte zu {{company}}, {{firstName}} — kein Problem, so oder so.`,
          reSubj: "Re: die Zahlen aus dem Audit",
          reframe: `Verständlicher Einwand, {{firstName}} — unser ${audit} existiert genau dafür: Sie sehen die Zahl, bevor Sie etwas ausgeben. Möchten Sie sie sehen?`,
          ack: `Verstanden, {{firstName}} — ich melde mich, wenn der Zeitpunkt für {{company}} besser passt. Klingt das fair für Sie?`,
          follow: `Wie versprochen melde ich mich zurück, {{firstName}} — passt es jetzt besser für {{company}}?`,
          referral: `Danke für die Offenheit, {{firstName}} — mit wem bei {{company}} sollte ich stattdessen sprechen?`,
          answer: `Gute Frage, {{firstName}} — genau das deckt unser ${audit} ab. Möchten Sie die Kurzfassung sehen?`,
          close: `Alles gut, {{firstName}} — ich schließe das hier ab. Falls {{company}} das Audit später möchte, bleibt die Tür für Sie offen.`,
        }
      : {
          s1subj: "où les rendez-vous se perdent",
          s1body: `J'ai remarqué que {{company}} réserve encore la plupart de ses patients par téléphone — c'est là que les absences apparaissent. Notre « ${audit} » montre aux cabinets où les rendez-vous se perdent, {{firstName}}. Un coup d'œil rapide vous intéresse ?`,
          s2subj: "les chiffres de l'audit",
          s2body: `Notre « ${audit} » donne un chiffre : ${price} — mesuré, jamais promis. Voulez-vous le résumé pour {{company}}, {{firstName}} ?`,
          s3subj: "un appel de 20 minutes",
          s3body: `C'est un appel de 20 minutes, {{firstName}} — aucune préparation, aucun engagement. Cela vous convient ?`,
          s4subj: "je ferme le dossier",
          s4body: `Je ferme le dossier {{company}}, {{firstName}} — aucun souci, quoi qu'il en soit.`,
          reSubj: "Re: les chiffres de l'audit",
          reframe: `Objection compréhensible, {{firstName}} — notre « ${audit} » existe pour cela : vous voyez le chiffre avant de dépenser quoi que ce soit. Voulez-vous le voir ?`,
          ack: `Compris, {{firstName}} — je reviens vers vous quand le moment conviendra mieux à {{company}}. Cela vous semble juste ?`,
          follow: `Comme promis, je reviens vers vous, {{firstName}} — est-ce un meilleur moment pour {{company}} ?`,
          referral: `Merci pour votre franchise, {{firstName}} — à qui chez {{company}} devrais-je parler ?`,
          answer: `Bonne question, {{firstName}} — c'est exactement ce que couvre notre « ${audit} ». Voulez-vous le résumé ?`,
          close: `Très bien, {{firstName}} — je clos le dossier. Si {{company}} souhaite l'audit plus tard, la porte vous reste ouverte.`,
        };
  return {
    entry: "step-1",
    nodes: [
      { id: "step-1", type: "step", channel: "email", content: { subject: t.s1subj, body: t.s1body } },
      { id: "delay-1", type: "delay", amount: 2, unit: "days" },
      { id: "step-2", type: "step", channel: "email", content: { subject: t.s2subj, body: t.s2body } },
      {
        id: "branch-reply",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
          { when: { intent: "objection_price" }, goto: "step-reframe-price", pipeline: "replied" },
          { when: { intent: "objection_timing" }, goto: "step-ack-timing", pipeline: "replied" },
          { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
          { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
          { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
          { when: "default", goto: "step-3" },
        ],
      },
      { id: "step-3", type: "step", channel: "email", content: { subject: t.s3subj, body: t.s3body } },
      { id: "delay-2", type: "delay", amount: 4, unit: "days" },
      { id: "step-4", type: "step", channel: "email", content: { subject: t.s4subj, body: t.s4body } },
      { id: "step-reframe-price", type: "step", channel: "email", content: { subject: t.reSubj, body: t.reframe, threaded: true } },
      { id: "step-ack-timing", type: "step", channel: "email", content: { subject: t.reSubj, body: t.ack, threaded: true } },
      { id: "delay-timing", type: "delay", amount: 30, unit: "days" },
      { id: "step-timing-follow", type: "step", channel: "email", content: { subject: t.reSubj, body: t.follow, threaded: true } },
      { id: "step-referral", type: "step", channel: "email", content: { subject: t.reSubj, body: t.referral, threaded: true } },
      { id: "step-answer", type: "step", channel: "email", content: { subject: t.reSubj, body: t.answer, threaded: true } },
      { id: "step-close", type: "step", channel: "email", content: { subject: t.reSubj, body: t.close, threaded: true } },
      { id: "end-won", type: "end" },
      { id: "end-lost", type: "end" },
    ],
    edges: [
      { from: "step-1", to: "delay-1" },
      { from: "delay-1", to: "step-2" },
      { from: "step-2", to: "branch-reply" },
      { from: "step-3", to: "delay-2" },
      { from: "delay-2", to: "step-4" },
      { from: "step-4", to: "end-lost" },
      { from: "step-reframe-price", to: "branch-reply" },
      { from: "step-ack-timing", to: "delay-timing" },
      { from: "delay-timing", to: "step-timing-follow" },
      { from: "step-timing-follow", to: "branch-reply" },
      { from: "step-referral", to: "end-lost" },
      { from: "step-answer", to: "branch-reply" },
      { from: "step-close", to: "end-lost" },
    ],
  };
}

function fakeGraph(prompt: string): object {
  // Grounding simulation: only use facts that actually appear in the prompt's
  // context block (as the real prompt instructs the model).
  const audit = prompt.includes(FACT_AUDIT) ? FACT_AUDIT : "our service";
  const price = prompt.includes(FACT_PRICE) ? FACT_PRICE : "our pricing";

  // v2-shaped prompts (no STRATEGY block) get the pre-playbook shape.
  if (!prompt.includes("STRATEGY (the selling method")) return legacyGraph(audit, price);

  // NEVER SAY simulation: a compliant model avoids the terms; the banMode
  // modes model a model that slips once (repaired) or keeps slipping (typed
  // failure). The repair prompt is recognizable by its FAILED marker.
  const isRepair = prompt.includes("FAILED validation");
  const terms = [...(prompt.match(/NEVER SAY[^:]*: (.+)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  const violate = banMode === "always" || (banMode === "once" && !isRepair);

  // L1 (DEC-072): v8/v9-shaped prompts carry the OUTPUT LANGUAGE section — a
  // compliant model writes the whole graph in that language (facts from the
  // prompt's own context block, which a German workspace stores in German);
  // the languageMode modes model a model that ignores the directive and emits
  // English (the deterministic rail must catch it → repair → typed failure).
  const langMatch = prompt.match(/Write ALL human-visible copy in ([A-Za-z]+) \(/);
  if (langMatch) {
    const ignore = languageMode === "always" || (languageMode === "once" && !isRepair);
    if (!ignore) {
      if (langMatch[1] === "German") {
        return localizedCraftGraph(
          "de",
          prompt.includes(FACT_AUDIT_DE) ? FACT_AUDIT_DE : audit,
          prompt.includes(FACT_PRICE_DE) ? FACT_PRICE_DE : price,
        );
      }
      if (langMatch[1] === "French") return localizedCraftGraph("fr", audit, price);
    }
    // Ignoring the directive: fall through to the ENGLISH craft shape below.
  }

  // G2: v7-shaped prompts (guided) get the all-guided-briefs shape; the ban,
  // when violating, lands INSIDE a brief (proves the scan covers brief text).
  // Channel choice follows the prompt's own channels line (honest absence).
  if (prompt.includes('EVERY one mode "guided"')) {
    return guidedGraph(
      audit,
      violate && terms.length > 0 ? ` (never ${terms[0]})` : "",
      !prompt.includes('"email" ONLY.'),
    );
  }

  const dirty = violate && terms.length > 0 ? ` We offer ${terms[0]}.` : "";
  return craftGraph(audit, price, dirty);
}

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => {
      toolCalls += 1;
      lastPrompt = params.prompt;
      return {
        input: fakeGraph(params.prompt),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => new Array(1536).fill(0.001)),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

// ── Structural helpers (M1a acceptance — asserted, not eyeballed) ────────────

/** Steps in the order a NON-replying lead experiences them (branch → default). */
function followUpSteps(graph: CampaignGraph): StepNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map(graph.edges.map((e) => [e.from, e.to]));
  const steps: StepNode[] = [];
  let cursor: string | undefined = graph.entry;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    if (node.type === "step") steps.push(node);
    cursor =
      node.type === "branch"
        ? node.cases.find((c) => c.when === "default")?.goto
        : next.get(cursor);
  }
  return steps;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const questions = (s: string) => (s.match(/\?/g) ?? []).length;

/** Violations of the arc structure; empty = the sequence exhibits the arc. */
function arcViolations(graph: CampaignGraph): string[] {
  const steps = followUpSteps(graph);
  const v: string[] = [];
  if (steps.length < 3) v.push(`only ${steps.length} follow-up steps — no room for objection-preempt + breakup roles`);
  const opener = steps[0];
  if (opener) {
    const body = opener.content.body ?? "";
    if (words(body) > OPENER_WORD_CAP) v.push(`opener over the ${OPENER_WORD_CAP}-word cap`);
    if (!body.trim().endsWith("?")) v.push("opener does not end with its question");
    if (questions(body) !== 1) v.push("opener must ask exactly one question");
  }
  for (const s of steps) {
    if (questions(s.content.body ?? "") > 1) v.push(`${s.id} asks more than one question (one CTA per message)`);
  }
  for (let i = 1; i < steps.length; i++) {
    if (words(steps[i]!.content.body ?? "") >= words(steps[i - 1]!.content.body ?? "")) {
      v.push(`${steps[i]!.id} is not shorter than ${steps[i - 1]!.id}`);
    }
  }
  const last = steps[steps.length - 1];
  if (last && !/no worries|either way|close|closing|door'?s open/i.test(last.content.body ?? "")) {
    v.push("last step is not a polite breakup (no easy-out language)");
  }
  return v;
}

describe.skipIf(!hasInfra)("planCampaign integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let wsC: string;
  let agentId: string;
  let emptyAgentId: string;
  let craftAgentId: string;
  let guidedAgentId: string;
  let guidedNoSmsAgentId: string;
  let wsDE: string;
  let germanAgentId: string;
  let flipAgentId: string;
  const deps = () => ({ prisma: app, gateway });

  beforeEach(() => {
    mode = "good";
    banMode = "none";
    languageMode = "honor";
    toolCalls = 0;
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `pl-${suffix}`, slug: `pl-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "PA", slug: `pla-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "PB", slug: `plb-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: wsA, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    emptyAgentId = (
      await owner.agent.create({
        data: { workspaceId: wsB, name: "NoContext", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    // M1a fixture: same goal, a persisted category, and a strategy block
    // riding guardrails (notes + neverSay).
    craftAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "Crafted",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: { email: 200 },
            consent: null,
            strategy: {
              strategyNotes: "Lead with the audit, never discount.",
              neverSay: ["rock-bottom prices"],
            },
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;

    // G1 (DEC-070): guided fixtures — wsC has an ACTIVE Twilio sender (the
    // guided precondition) + a guided agent; the no-sms guided agent lives in
    // wsA (guided without a sender plans scripted — honest absence).
    wsC = (
      await owner.workspace.create({
        data: { agencyId, name: "PC", slug: `plc-${suffix}`, settings: {} },
      })
    ).id;
    await owner.senderConnection.create({
      data: { workspaceId: wsC, type: "TWILIO_SMS", fromEmail: "+15005550006", fromName: "SMS" },
    });
    const guidedGuardrails = {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 100, sms: 10 },
      consent: null,
      composeMode: "guided",
      strategy: { neverSay: ["rock-bottom prices"] },
      unsubscribeFooter: true,
      suppressionCheck: true,
    };
    guidedAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsC,
          name: "GuidedBooker",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: guidedGuardrails,
        },
      })
    ).id;
    guidedNoSmsAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "GuidedNoSms",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: guidedGuardrails,
        },
      })
    ).id;

    // Stored BusinessContext (workspace layer) carrying the concrete facts the
    // planner's copy must trace to (DEC-015).
    const snapshot = {
      chunkId: "chunk-x",
      sourceId: "src-x",
      sourceLabel: "site",
      sourceType: "TEXT",
      locator: "site",
      quote: "verbatim",
    };
    const contextFields = {
      offer: {
        value: `We book dental appointments with a ${FACT_AUDIT}.`,
        citations: [snapshot],
        source: "distilled",
      },
      pricing: {
        value: `Pricing starts at ${FACT_PRICE}.`,
        citations: [snapshot],
        source: "distilled",
      },
      usp: {
        value: "Only we guarantee 15 new patients.",
        citations: [snapshot],
        source: "distilled",
      },
      icp: { value: "Dentists in Austin", citations: [], source: "typed" },
    };
    await owner.businessContext.create({
      data: {
        workspaceId: wsA,
        agentId: null,
        status: "READY",
        fields: contextFields,
        rawSummary: "Dental growth business.",
      },
    });
    await owner.businessContext.create({
      data: {
        workspaceId: wsC,
        agentId: null,
        status: "READY",
        fields: contextFields,
        rawSummary: "Dental growth business.",
      },
    });

    // L1 (DEC-072): a GERMAN workspace — German evidence distills to German
    // field values, so grounded German copy cites German facts (DEC-015 holds
    // across languages). The agent carries the detected language rider the
    // distiller writes.
    wsDE = (
      await owner.workspace.create({
        data: { agencyId, name: "PD", slug: `pld-${suffix}`, settings: {} },
      })
    ).id;
    germanAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsDE,
          name: "Termine",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "Europe/Berlin" },
            dailyCap: { email: 200 },
            consent: null,
            language: "de",
            languageSource: "detected",
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    // The Settings-flip fixture: an ENGLISH agent (no language rider) in wsA —
    // full valid guardrails, exactly what the wizard's create() seeds.
    flipAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "Flipper",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: { email: 200 },
            consent: null,
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: wsDE,
        agentId: null,
        status: "READY",
        fields: {
          offer: {
            value: `Wir buchen Zahnarzttermine mit unserem Programm "${FACT_AUDIT_DE}".`,
            citations: [snapshot],
            source: "distilled",
          },
          pricing: {
            value: `Der Preis: ${FACT_PRICE_DE}.`,
            citations: [snapshot],
            source: "distilled",
          },
          icp: { value: "Zahnarztpraxen in Berlin", citations: [], source: "typed" },
        },
        rawSummary: "Ein Zahnarzt-Wachstumsunternehmen.",
      },
    });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("plans, validates, dry-runs, and persists v1 (source AI) on the primary campaign", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });

    expect(result.campaign.agentId).toBe(agentId);
    expect(result.campaign.graphId).toBe(result.graphRow.id);
    expect(result.graphRow.version).toBe(1);
    expect(result.graphRow.source).toBe("AI");

    // Executor round-trip: reply branch resolved as "interested".
    const kinds = result.dryRun.map((a) => a.kind);
    expect(kinds).toContain("send");
    expect(kinds).toContain("wait");
    expect(kinds).toContain("branch");
    expect(kinds[kinds.length - 1]).toBe("end");

    // Tokens appear in step content (P1.4 acceptance).
    const copy = JSON.stringify(result.graph);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain("{{company}}");

    // DEC-015: ≥2 concrete facts traceable to the STORED BusinessContext.
    const stored = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsA, agentId: null } }),
    );
    const storedValues = JSON.stringify(stored.fields);
    for (const fact of [FACT_AUDIT, FACT_PRICE]) {
      expect(copy).toContain(fact);
      expect(storedValues).toContain(fact);
    }
  });

  it("re-planning bumps the version and repoints the campaign", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });
    expect(result.graphRow.version).toBe(2);
    expect(result.campaign.graphId).toBe(result.graphRow.id);
  });

  it("broken model output is caught after one repair and NEVER persisted", async () => {
    mode = "broken";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsA } });
    const beforeCampaign = await owner.campaign.findFirstOrThrow({ where: { agentId } });

    await expect(planCampaign(deps(), { workspaceId: wsA, agentId })).rejects.toThrow(PlannerError);

    expect(await owner.campaignGraph.count({ where: { workspaceId: wsA } })).toBe(before);
    const afterCampaign = await owner.campaign.findFirstOrThrow({ where: { agentId } });
    expect(afterCampaign.graphId).toBe(beforeCampaign.graphId);
  });

  it("refuses to plan without a BusinessContext (DEC-015 grounding)", async () => {
    await expect(planCampaign(deps(), { workspaceId: wsB, agentId: emptyAgentId })).rejects.toThrow(
      /BusinessContext is empty/,
    );
  });

  // ── M1a (DEC-065): selling craft + strategy block ──────────────────────────

  it("the planned sequence exhibits the arc STRUCTURALLY; the pre-playbook shape does not", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });

    // After: opener ≤ cap ending with its single question, one CTA per step,
    // strictly decreasing length, breakup last — zero violations.
    expect(arcViolations(result.graph)).toEqual([]);
    const steps = followUpSteps(result.graph);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(words(steps[0]!.content.body ?? "")).toBeLessThanOrEqual(OPENER_WORD_CAP);

    // Before: the pre-M1a shape (kept verbatim) violates the arc.
    const legacy = legacyGraph(FACT_AUDIT, FACT_PRICE) as CampaignGraph;
    expect(arcViolations(legacy).length).toBeGreaterThan(0);

    // The prompt carried the agent's derived arc + owner strategy (wiring proof).
    expect(lastPrompt).toContain("Arc: Diagnose, then prescribe");
    expect(lastPrompt).toContain("patient-outcome-first");
    expect(lastPrompt).toContain("Lead with the audit, never discount.");
    expect(lastPrompt).toContain('"rock-bottom prices"');

    // Grounding is unchanged by the craft pass (DEC-015 still holds).
    const copy = JSON.stringify(result.graph);
    expect(copy).toContain(FACT_AUDIT);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain("{{company}}");
  });

  it("neverSay violation → bounded auto-repair → clean graph persisted (2 model calls)", async () => {
    banMode = "once";
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });
    expect(toolCalls).toBe(2);
    expect(JSON.stringify(result.graph).toLowerCase()).not.toContain("rock-bottom prices");
    // The repaired graph is a real persisted version.
    expect(result.graphRow.source).toBe("AI");
  });

  it("neverSay still violated after repair → typed failure, NOTHING persisted", async () => {
    banMode = "always";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsA } });
    await expect(
      planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId }),
    ).rejects.toThrow(PlannerError);
    expect(toolCalls).toBe(2);
    expect(await owner.campaignGraph.count({ where: { workspaceId: wsA } })).toBe(before);
  });

  // ── M1b (DEC-068): the six-intent REPLY PLAYBOOK ───────────────────────────

  it("plans the six-case reply branch — every strategy intent routes to its path with its stage pin", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });
    const branch = result.graph.nodes.find((n) => n.type === "branch");
    expect(branch?.type).toBe("branch");
    if (branch?.type !== "branch") return;

    const caseFor = (intent: string) =>
      branch.cases.find((c) => c.when !== "default" && c.when.intent === intent);
    expect(caseFor("interested")).toMatchObject({ pipeline: "booked" });
    expect(caseFor("objection_price")).toMatchObject({ pipeline: "replied" });
    expect(caseFor("objection_timing")).toMatchObject({ pipeline: "replied" });
    expect(caseFor("wrong_person")).toMatchObject({ pipeline: "replied" });
    expect(caseFor("info_request")).toMatchObject({ pipeline: "replied" });
    expect(caseFor("not_interested")).toMatchObject({ pipeline: "lost" });
    expect(branch.cases.some((c) => c.when === "default")).toBe(true);

    // Strategy cases route to STEP nodes; rejoining paths edge back to the branch.
    const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));
    for (const intent of ["objection_price", "objection_timing", "wrong_person", "info_request", "not_interested"]) {
      expect(byId.get(caseFor(intent)!.goto)?.type, intent).toBe("step");
    }
    const rejoins = (from: string) => result.graph.edges.some((e) => e.from === from && e.to === branch.id);
    expect(rejoins(caseFor("objection_price")!.goto)).toBe(true);
    expect(rejoins(caseFor("info_request")!.goto)).toBe(true);

    // The prompt carried the playbook (wiring proof).
    expect(lastPrompt).toContain("REPLY PLAYBOOK");
    expect(lastPrompt).toContain('{"intent":"not_interested"}, "pipeline":"lost"');
  });

  it("dry-runs the terminal strategy paths: not_interested → graceful close → end with stage lost", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });
    const branch = result.graph.nodes.find((n) => n.type === "branch");
    if (branch?.type !== "branch") throw new Error("no branch");

    const lost = execute(result.graph, { events: { [branch.id]: { intent: "not_interested" } } });
    expect(lost.find((a) => a.kind === "branch")).toMatchObject({ matched: "intent:not_interested" });
    expect(lost).toContainEqual(expect.objectContaining({ kind: "pipeline_move", stage: "lost" }));
    // The close step SENDS (graceful close is a real message), then the path ends.
    const closeStep = branch.cases.find((c) => c.when !== "default" && c.when.intent === "not_interested")!.goto;
    expect(lost).toContainEqual(expect.objectContaining({ kind: "send", nodeId: closeStep }));
    expect(lost.at(-1)?.kind).toBe("end");

    const referral = execute(result.graph, { events: { [branch.id]: { intent: "wrong_person" } } });
    expect(referral.find((a) => a.kind === "branch")).toMatchObject({ matched: "intent:wrong_person" });
    expect(referral.at(-1)?.kind).toBe("end");
  });

  it("REGRESSION: an agent with legacy guardrails and no category plans end-to-end unchanged", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });
    expect(result.graphRow.source).toBe("AI");
    // The prompt renders the defaults — no owner strategy, no bans, and the
    // goal's default arc under the neutral tone (legacy rows never crash).
    expect(lastPrompt).toContain("Owner strategy notes: (none)");
    expect(lastPrompt).toMatch(/NEVER SAY[^:]*: \(none\)/);
    expect(lastPrompt).toContain("Arc: Diagnose, then prescribe");
    expect(lastPrompt).toContain("default professional tone");
    // G1 scripted regression: no guided material anywhere near a scripted plan.
    expect(lastPrompt).not.toContain("guided");
  });

  // ── G1 (DEC-070) / G2 (DEC-071): guided mode — briefs composed at send ─────

  it("GUIDED: plans BRIEFS for EVERY main step (email briefs carry subjectHint; strategy steps stay scripted); briefs survive all 3 layers", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsC, agentId: guidedAgentId });

    // The prompt was the v7 guided variant (both channels available in wsC).
    expect(lastPrompt).toContain('EVERY one mode "guided"');

    const steps = result.graph.nodes.filter((n): n is StepNode => n.type === "step");
    const guidedSteps = steps.filter((s) => s.mode === "guided");
    const scriptedSteps = steps.filter((s) => s.mode === undefined);
    expect(guidedSteps.filter((s) => s.channel === "sms").length).toBeGreaterThanOrEqual(1);
    expect(guidedSteps.filter((s) => s.channel === "email").length).toBeGreaterThanOrEqual(1);
    for (const s of guidedSteps) {
      expect(s.brief).toBeDefined();
      expect(s.brief!.talkingPoints.length).toBeGreaterThanOrEqual(3);
      expect(s.brief!.talkingPoints.length).toBeLessThanOrEqual(6);
      expect(s.content.body).toBeUndefined(); // briefs, never copy
      expect(s.content.subject).toBeUndefined();
      // G2: subjectHint rides EMAIL briefs only.
      if (s.channel === "email") expect(s.brief!.subjectHint).toBeTruthy();
      else expect(s.brief!.subjectHint).toBeUndefined();
      // DEC-015 grounding holds for brief material too (the fake lifts the
      // fact from the prompt's context block).
      expect(JSON.stringify(s.brief)).toContain(FACT_AUDIT);
    }
    // Reply-strategy steps stay fully scripted email (DEC-070(7) — the
    // reply-draft wave owns guided replies).
    expect(scriptedSteps.length).toBeGreaterThanOrEqual(1);
    for (const s of scriptedSteps) {
      expect(s.channel).toBe("email");
      expect(s.content.body).toBeTruthy();
    }
    // Persisted like any other version — the graph row is real.
    expect(result.graphRow.source).toBe("AI");
  });

  it("GUIDED: a guided agent WITHOUT an active Twilio sender plans guided EMAIL briefs (G2 — email needs no extra sender)", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: guidedNoSmsAgentId });
    // v7 renders regardless of the sms sender; the channels line stays honest.
    expect(lastPrompt).toContain('EVERY one mode "guided"');
    expect(lastPrompt).toContain('- Channel: "email" ONLY.');
    const steps = result.graph.nodes.filter((n): n is StepNode => n.type === "step");
    expect(steps.every((s) => s.channel === "email")).toBe(true);
    const guidedSteps = steps.filter((s) => s.mode === "guided");
    expect(guidedSteps.length).toBeGreaterThanOrEqual(3);
    for (const s of guidedSteps) {
      expect(s.brief).toBeDefined();
      expect(s.brief!.subjectHint).toBeTruthy();
      expect(s.content.body).toBeUndefined();
    }
  });

  it("GUIDED: a banned phrase in a BRIEF walks the bounded repair → clean briefs persisted", async () => {
    banMode = "once";
    const result = await planCampaign(deps(), { workspaceId: wsC, agentId: guidedAgentId });
    expect(toolCalls).toBe(2);
    expect(JSON.stringify(result.graph).toLowerCase()).not.toContain("rock-bottom prices");
  });

  it("GUIDED: briefs still dirty after repair → typed failure, NOTHING persisted", async () => {
    banMode = "always";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsC } });
    await expect(
      planCampaign(deps(), { workspaceId: wsC, agentId: guidedAgentId }),
    ).rejects.toThrow(PlannerError);
    expect(toolCalls).toBe(2);
    expect(await owner.campaignGraph.count({ where: { workspaceId: wsC } })).toBe(before);
  });

  // ── F1 (DEC-068): outcome-aware regen — the acceptance fixture ─────────────

  it("regen carries OBSERVED OUTCOMES only above threshold, citing the rollup's own numbers", async () => {
    const outcomesAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "Outcomes",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {},
        },
      })
    ).id;

    // FIRST generation: no campaign exists when outcomes load → all-none →
    // NO outcomes section at all (young campaigns plan exactly as v3 did).
    const v1 = await planCampaign(deps(), { workspaceId: wsA, agentId: outcomesAgentId });
    expect(v1.graphRow.version).toBe(1);
    expect(lastPrompt).not.toContain("OBSERVED OUTCOMES");

    // Seed the ledger: 62 sends on step-1 (ok; 3 distinct repliers, 1
    // interested), 24 on step-2 (low; 1 opt-out), 7 on step-3 (below floor).
    const campaignId = v1.campaign.id;
    const base = Date.now() - 86_400_000;
    const cid = (tag: string, i: number) => `f1c-${tag}${i}-${suffix}`;
    const mid = (tag: string, i: number) => `f1m-${tag}${i}-${suffix}`;
    const spec = [
      { step: "step-1", tag: "a", n: 62 },
      { step: "step-2", tag: "b", n: 24 },
      { step: "step-3", tag: "c", n: 7 },
    ];
    const contacts = [];
    const messages = [];
    for (const { step, tag, n } of spec) {
      for (let i = 0; i < n; i++) {
        contacts.push({
          id: cid(tag, i),
          workspaceId: wsA,
          source: "import",
          optOut: {},
          tags: [],
          email: `f1-${tag}${i}-${suffix}@t.test`,
        });
        messages.push({
          id: mid(tag, i),
          workspaceId: wsA,
          campaignId,
          contactId: cid(tag, i),
          channel: "email",
          direction: "OUTBOUND" as const,
          subject: "s",
          body: "b",
          stepNodeId: step,
          sentAt: new Date(base + i * 1000),
        });
      }
    }
    await owner.contact.createMany({ data: contacts });
    await owner.message.createMany({ data: messages });
    for (const r of [
      { i: 0, intent: "interested" },
      { i: 1, intent: "replied" },
      { i: 2, intent: "replied" },
    ]) {
      const rid = `f1r-${r.i}-${suffix}`;
      await owner.message.create({
        data: {
          id: rid,
          workspaceId: wsA,
          campaignId,
          contactId: cid("a", r.i),
          channel: "email",
          direction: "INBOUND",
          body: "re",
          inReplyToId: mid("a", r.i),
          intent: r.intent,
          sentAt: new Date(base + 100_000 + r.i * 1000),
        },
      });
      await owner.event.create({
        data: {
          workspaceId: wsA,
          type: "email.replied.v1",
          contactId: cid("a", r.i),
          campaignId,
          payload: { messageId: rid, intent: r.intent },
          occurredAt: new Date(base + 100_000 + r.i * 1000),
        },
      });
    }
    await owner.event.create({
      data: {
        workspaceId: wsA,
        type: "lead.unsubscribed.v1",
        contactId: cid("b", 0),
        campaignId,
        payload: { channel: "email" },
        occurredAt: new Date(base + 200_000),
      },
    });

    // The endpoint's own loader (the API calls exactly this) …
    const rollup = await withTenant(app, { workspaceId: wsA }, (tx) =>
      loadCampaignOutcomes(tx, outcomesAgentId),
    );
    const stepOf = (id: string) => rollup.steps.find((s) => s.stepNodeId === id)!;
    const [s1, s2, s3] = [stepOf("step-1"), stepOf("step-2"), stepOf("step-3")];
    expect(s1.signal).toBe("ok");
    expect(s2.signal).toBe("low");
    expect(s3.signal).toBe("none");
    expect(s3.replyRatePct).toBeNull(); // min-n gate lives in the payload

    // … is what the REGEN cites, verbatim, for low+ steps only.
    const v2 = await planCampaign(deps(), { workspaceId: wsA, agentId: outcomesAgentId });
    expect(v2.graphRow.version).toBe(2);
    expect(lastPrompt).toContain("OBSERVED OUTCOMES");
    expect(lastPrompt).toContain(
      `- step-1 (email): ${s1.sent} sent · reply rate ${s1.replyRatePct}% · ` +
        `positive-intent ${s1.positiveRatePct}% · opt-out ${s1.optOutRatePct}% — confidence: ok (≥50 sends)`,
    );
    expect(lastPrompt).toContain(
      `- step-2 (email): ${s2.sent} sent · reply rate ${s2.replyRatePct}% · ` +
        `positive-intent ${s2.positiveRatePct}% · opt-out ${s2.optOutRatePct}% — confidence: low (20–49 sends — directional only)`,
    );
    expect(lastPrompt).not.toContain("- step-3"); // below the floor — omitted…
    expect(lastPrompt).toContain("Steps below 20 sends are omitted"); // …and said so.

    // LAYERED prompt (v5, rebase delta): the outcomes section COEXISTS with
    // the full six-case REPLY PLAYBOOK — it composes with the v4 text, never
    // replaces it, and sits between STRATEGY and GUARDRAILS.
    expect(lastPrompt).toContain("REPLY PLAYBOOK (one case per classified intent — EXACTLY these six");
    for (const intent of [
      "interested",
      "objection_price",
      "objection_timing",
      "wrong_person",
      "info_request",
      "not_interested",
    ]) {
      expect(lastPrompt).toContain(`{"intent":"${intent}"}`);
    }
    expect(lastPrompt.indexOf("OBSERVED OUTCOMES")).toBeGreaterThan(lastPrompt.indexOf("STRATEGY"));
    expect(lastPrompt.indexOf("OBSERVED OUTCOMES")).toBeLessThan(lastPrompt.indexOf("GUARDRAILS"));
    // …and the planned graph still satisfies the playbook slice gate (the
    // six-case branch validated by validateAll on the layered prompt's output).
    const branch = v2.graph.nodes.find((n) => n.type === "branch");
    expect(branch && branch.type === "branch" ? branch.cases.length : 0).toBeGreaterThanOrEqual(7);
  });

  // ── L1 (DEC-072): agent output language ────────────────────────────────────

  it("GERMAN agent: sequence + step previews + reply-strategy drafts are ENTIRELY German (the acceptance fixture)", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsDE, agentId: germanAgentId });

    // The prompt was the v7 language variant with the full playbook intact.
    expect(lastPrompt).toContain("OUTPUT LANGUAGE (the customer's language — non-negotiable):");
    expect(lastPrompt).toContain("Write ALL human-visible copy in German (Deutsch)");
    expect(lastPrompt).toContain("REPLY PLAYBOOK");

    // MAIN sequence (wizard step-2 previews render exactly these nodes)…
    const steps = result.graph.nodes.filter((n): n is StepNode => n.type === "step");
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get("step-1")!.content.subject).toBe("wo Termine verloren gehen");
    expect(byId.get("step-1")!.content.body).toContain("Mir ist aufgefallen");
    expect(byId.get("step-4")!.content.body).toContain("Ich schließe die Akte");
    // …and the AI reply drafts (the six-case playbook's strategy steps).
    expect(byId.get("step-reframe-price")!.content.body).toContain("Verständlicher Einwand");
    expect(byId.get("step-close")!.content.body).toContain("bleibt die Tür für Sie offen");
    expect(byId.get("step-referral")!.content.body).toContain("Danke für die Offenheit");

    // Machine identifiers stayed English (branch cases route by shared enum).
    const branch = result.graph.nodes.find((n) => n.type === "branch");
    if (branch?.type !== "branch") throw new Error("no branch");
    expect(branch.cases.find((c) => c.when !== "default" && c.when.intent === "not_interested"))
      .toMatchObject({ pipeline: "lost" });

    // Merge tokens stayed literal — renderTokens resolves them at send time.
    const copy = JSON.stringify(result.graph);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain("{{company}}");

    // DEC-015 across languages: German facts traceable to the stored context.
    const stored = await withTenant(app, { workspaceId: wsDE }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsDE, agentId: null } }),
    );
    const storedValues = JSON.stringify(stored.fields);
    for (const fact of [FACT_AUDIT_DE, FACT_PRICE_DE]) {
      expect(copy).toContain(fact);
      expect(storedValues).toContain(fact);
    }
    expect(result.graphRow.source).toBe("AI");
  });

  it("GERMAN agent: the model IGNORING the language → deterministic rail → repair → German persisted (2 calls)", async () => {
    languageMode = "once";
    const result = await planCampaign(deps(), { workspaceId: wsDE, agentId: germanAgentId });
    expect(toolCalls).toBe(2);
    // The repair prompt named the mismatch deterministically…
    expect(lastPrompt).toContain("FAILED validation");
    expect(lastPrompt).toContain("output language is German (Deutsch)");
    // …and the persisted graph is the German one.
    const steps = result.graph.nodes.filter((n): n is StepNode => n.type === "step");
    expect(steps.find((s) => s.id === "step-1")!.content.subject).toBe("wo Termine verloren gehen");
  });

  it("GERMAN agent: still English after the repair → typed failure, NOTHING persisted", async () => {
    languageMode = "always";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsDE } });
    await expect(
      planCampaign(deps(), { workspaceId: wsDE, agentId: germanAgentId }),
    ).rejects.toThrow(PlannerError);
    expect(toolCalls).toBe(2);
    expect(await owner.campaignGraph.count({ where: { workspaceId: wsDE } })).toBe(before);
  });

  it("SETTINGS FLIP: an English agent flipped to French plans French on the NEXT regen", async () => {
    // First generation — no language rider: the v5 prompt, English graph.
    const v1 = await planCampaign(deps(), { workspaceId: wsA, agentId: flipAgentId });
    expect(lastPrompt).not.toContain("OUTPUT LANGUAGE");
    expect(v1.graphRow.version).toBe(1);

    // The owner flips the Settings Language row to French (the PATCH writes
    // the rider with source "owner").
    const agent = await owner.agent.findUniqueOrThrow({ where: { id: flipAgentId } });
    await owner.agent.update({
      where: { id: flipAgentId },
      data: {
        guardrails: {
          ...(agent.guardrails as object),
          language: "fr",
          languageSource: "owner",
        } as object,
      },
    });

    const v2 = await planCampaign(deps(), { workspaceId: wsA, agentId: flipAgentId });
    expect(v2.graphRow.version).toBe(2);
    expect(lastPrompt).toContain("Write ALL human-visible copy in French (Français)");
    const steps = v2.graph.nodes.filter((n): n is StepNode => n.type === "step");
    expect(steps.find((s) => s.id === "step-1")!.content.subject).toBe(
      "où les rendez-vous se perdent",
    );
    expect(steps.find((s) => s.id === "step-close")!.content.body).toContain(
      "la porte vous reste ouverte",
    );
    // Grounding still traces to wsA's ENGLISH context — quoted product facts
    // stay verbatim inside French copy.
    expect(JSON.stringify(v2.graph)).toContain(FACT_AUDIT);
  });

  it("validateAll language rail is UNARMED for English agents (byte-identical legacy behavior)", async () => {
    // The English craft graph passes with the default/en language exactly as
    // before this unit — planning the legacy agent exercises it end-to-end.
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });
    expect(result.graphRow.source).toBe("AI");
    expect(lastPrompt).not.toContain("OUTPUT LANGUAGE");
  });
});
