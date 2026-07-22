/**
 * Sandbox content check (owner finding 4c, PR #106) — a few TEXT-ONLY turns
 * through the REAL gateway against the demo fixture's system prompt, no
 * telephony: verifies the first substantive answers LEAD outcome-first
 * (goal → orchestration → outcome) with deliverability as a supporting rail,
 * never the opener. The deliverability question is asked LAST — invited, it
 * is the right answer; leading with it was the measured defect.
 *
 * Loud: prints the full sandbox transcript (synthetic fixture content only)
 * and exits 1 when a substantive answer leads with the rail.
 */
import { demoCallContext } from "./demo-context";
import { MetricsCollector } from "./metrics";
import { createVoiceGateway } from "./runtime";

const OUTCOME_TERMS = [
  "goal",
  "book",
  "orchestrat",
  "outcome",
  "meeting",
  "appointment",
  "prospect",
  "intent",
];
const RAIL_TERMS = ["deliverab", "suppression", "warmup", "sender health", "spam"];

const TURNS = [
  "So what does Clientforce actually do?",
  "How is that different from other outreach tools?",
  "What about email deliverability — do you handle that?",
];
/** The salience checks apply to the substantive answers only — the last turn
 *  INVITES the rail. */
const CHECKED_TURNS = 2;

function leadCheck(reply: string): { ok: boolean; detail: string } {
  const lower = reply.toLowerCase();
  const firstAt = (terms: string[]) =>
    Math.min(
      ...terms.map((t) => {
        const i = lower.indexOf(t);
        return i === -1 ? Number.POSITIVE_INFINITY : i;
      }),
    );
  const outcomeAt = firstAt(OUTCOME_TERMS);
  const railAt = firstAt(RAIL_TERMS);
  if (!Number.isFinite(outcomeAt)) return { ok: false, detail: "no outcome-first term in the reply" };
  if (railAt < outcomeAt) return { ok: false, detail: "deliverability LEADS the reply" };
  return {
    ok: true,
    detail: Number.isFinite(railAt) ? "outcome-led before any rail term" : "outcome-led, no rail terms",
  };
}

async function main(): Promise<void> {
  const context = demoCallContext(process.env.DEMO_VARIANT?.trim() || "named");
  const gateway = createVoiceGateway(new MetricsCollector());
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "assistant", content: context.disclosure },
  ];
  let failed = false;
  for (let i = 0; i < TURNS.length; i++) {
    turns.push({ role: "user", content: TURNS[i]! });
    let reply = "";
    for await (const delta of gateway.streamVoice({ system: context.systemPrompt, turns })) {
      reply += delta;
    }
    reply = reply.trim();
    turns.push({ role: "assistant", content: reply });
    console.log(`\n[sandbox] Q${i + 1}: ${TURNS[i]}`);
    console.log(`[sandbox] A${i + 1}: ${reply}`);
    if (i < CHECKED_TURNS) {
      const check = leadCheck(reply);
      console.log(`[sandbox] lead-check A${i + 1}: ${check.ok ? "PASS" : "FAIL"} — ${check.detail}`);
      if (!check.ok) failed = true;
    }
  }
  if (failed) {
    console.error("\n[sandbox] FAIL — a substantive answer led with the rail (finding 4 not fixed)");
    process.exit(1);
  }
  console.log("\n[sandbox] PASS — substantive answers lead outcome-first; the rail answers when asked");
}

main().catch((err) => {
  console.error("[sandbox]", (err as Error).message);
  process.exit(1);
});
