"use client";

/**
 * B5 (DEC-130): the "Ask Ada to build" bottom sheet — the prototype's guided
 * builder chrome (progress bars, replayed transcript, option rows, the mint
 * READY panel) driven ENTIRELY deterministically: every answer maps onto the
 * real write schemas and lands through the real endpoints (POST /forms,
 * /proposals, /automations). Nothing is composed by a model — the planner's
 * prompts are locked (a standing rail) and "she never invents" holds by
 * construction here: templates + your typed words only.
 */
import { useMemo, useState } from "react";
import type { AgentListItem } from "@clientforce/core";
import { createAutomation, createForm, createProposal } from "./bold-live";
import { mono } from "./bold-cards";

export type GuildKind = "form" | "proposal" | "auto";

interface Option {
  name: string;
  sub: string;
  value: string;
}
interface Step {
  label: string;
  q: string;
  options?: Option[];
  input?: { placeholder: string; testId?: string };
}

const FORM_STEPS: Step[] = [
  {
    label: "WHAT KIND",
    q: "What is this form for?",
    options: [
      { name: "Take bookings", sub: "A time-and-details form — responses can join a campaign", value: "booking" },
      { name: "Answer enquiries", sub: "Questions land as contacts you can work", value: "enquiry" },
      { name: "Collect a waitlist", sub: "For when nothing is open yet", value: "waitlist" },
    ],
  },
  {
    label: "THE FIELDS",
    q: "Which fields do you need?",
    options: [
      { name: "Name, phone, what they need", sub: "Three fields — highest completion", value: "lean" },
      { name: "Add email and preferred time", sub: "Five fields — better routing", value: "fuller" },
      { name: "Add an open question", sub: "Six fields — richest context", value: "richest" },
    ],
  },
  {
    label: "REQUIRED OR NOT",
    q: "Which of them must they fill in?",
    options: [
      { name: "Name and phone only", sub: "Everything else optional — highest completion", value: "lean" },
      { name: "Name, phone and what they need", sub: "One more required field, better routing", value: "mid" },
      { name: "All of them", sub: "Fullest record — expect fewer submissions", value: "all" },
    ],
  },
  {
    label: "WHERE LEADS LAND",
    q: "Should new contacts join a campaign?",
    options: [], // filled from the live agent list at runtime
  },
  {
    label: "THE NAME",
    q: "What should the form be called?",
    input: { placeholder: "e.g. Book a time", testId: "bold-gb-name" },
  },
];

const PROPOSAL_STEPS: Step[] = [
  {
    label: "THE PRICE",
    q: "What are you putting in front of them? Type the number from your own pricing — nothing is invented for you.",
    input: { placeholder: "e.g. $4,800", testId: "bold-gb-price" },
  },
  {
    label: "WHAT IT'S CALLED",
    q: "What should the document be called?",
    input: { placeholder: "e.g. The full plan", testId: "bold-gb-name" },
  },
];

const AUTO_STEPS: Step[] = [
  {
    label: "THE TRIGGER",
    q: "What starts it?",
    options: [
      { name: "Somebody books", sub: "Any channel — a booking lands", value: "meeting_booked" },
      { name: "Somebody pays", sub: "A payment is detected", value: "payment_received" },
      { name: "A price objection arrives", sub: "A reply classified as an objection", value: "objection" },
      { name: "A new lead arrives", sub: "Form, widget or import", value: "lead_captured" },
    ],
  },
  {
    label: "THE ACTION",
    q: "What should happen? (Rules never send — messages stay behind the send boundary.)",
    options: [
      { name: "Tell the team", sub: "The run lands as a notification row", value: "notify_team" },
      { name: "Tag the contact", sub: 'Adds the tag "follow-up" — rename it any time', value: "add_tag" },
      { name: "End their campaign", sub: "Stops the sequence for that contact", value: "end_enrollment" },
    ],
  },
  {
    label: "THE NAME",
    q: "What should the rule be called?",
    input: { placeholder: "e.g. Booked → tell the team", testId: "bold-gb-name" },
  },
];

const TRIGGER_OF: Record<string, object> = {
  meeting_booked: { kind: "meeting_booked" },
  payment_received: { kind: "payment_received" },
  objection: { kind: "reply_classified", intents: ["objection"] },
  lead_captured: { kind: "lead_captured" },
};
const ACTION_OF: Record<string, object> = {
  notify_team: { kind: "notify_team", note: "This rule fired — take a look." },
  add_tag: { kind: "add_tag", tag: "follow-up" },
  end_enrollment: { kind: "end_enrollment" },
};

export function BoldGuidedBuild({
  kind,
  agents,
  onClose,
  onDone,
  flash,
}: {
  kind: GuildKind;
  agents: AgentListItem[];
  onClose: () => void;
  onDone: (kind: GuildKind, id: string | null) => void;
  flash: (msg: string) => void;
}) {
  const steps = useMemo<Step[]>(() => {
    if (kind === "form") {
      return FORM_STEPS.map((s) =>
        s.label === "WHERE LEADS LAND"
          ? {
              ...s,
              options: [
                ...agents.slice(0, 2).map((a) => ({
                  name: a.name,
                  sub: "Straight into that campaign, tagged from-form",
                  value: `agent:${a.id}`,
                })),
                { name: "No campaign — just a contact", sub: "You decide later, in Where it goes", value: "none" },
              ],
            }
          : s,
      );
    }
    return kind === "proposal" ? PROPOSAL_STEPS : AUTO_STEPS;
  }, [kind, agents]);

  const [answers, setAnswers] = useState<Array<{ step: Step; display: string; value: string }>>([]);
  const [inputVal, setInputVal] = useState("");
  const [built, setBuilt] = useState<{ id: string | null; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const idx = answers.length;
  const step = steps[idx];

  const finish = async (all: Array<{ step: Step; display: string; value: string }>) => {
    setBusy(true);
    const get = (label: string) => all.find((a) => a.step.label === label);
    try {
      if (kind === "form") {
        const kindV = get("WHAT KIND")!.value;
        const fieldsV = get("THE FIELDS")!.value;
        const reqV = get("REQUIRED OR NOT")!.value;
        const routeV = get("WHERE LEADS LAND")!.value;
        const title = get("THE NAME")!.value.trim() || "New form";
        const fields = [
          { key: "name", label: "Your name", type: "text", required: true },
          { key: "phone", label: "Phone", type: "phone", required: true },
          { key: "need", label: "What do you need?", type: "text", required: reqV !== "lean" },
          ...(fieldsV !== "lean"
            ? [
                { key: "email", label: "Email", type: "email", required: reqV === "all" },
                { key: "when", label: "Preferred time", type: "choice", required: reqV === "all", options: ["Mornings", "Afternoons", "Any"] },
              ]
            : []),
          ...(fieldsV === "richest"
            ? [{ key: "notes", label: "Anything else?", type: "longtext", required: reqV === "all" }]
            : []),
        ];
        const intro =
          kindV === "booking"
            ? "Pick a time that suits — it takes a minute."
            : kindV === "waitlist"
              ? "Leave your details and you hear the moment a spot opens."
              : "Ask away — a real answer comes back quickly.";
        const res = await createForm({
          title,
          intro,
          submitLabel: kindV === "booking" ? "Book it" : kindV === "waitlist" ? "Join the list" : "Send it",
          fields,
          routing: {
            tag: "from-form",
            ...(routeV.startsWith("agent:") ? { agentId: routeV.slice(6) } : {}),
          },
        });
        if (!res.ok) throw new Error(res.error);
        setBuilt({ id: (res.body as { id: string }).id, title });
      } else if (kind === "proposal") {
        const amount = get("THE PRICE")!.value.trim();
        const title = get("WHAT IT'S CALLED")!.value.trim() || "New proposal";
        const res = await createProposal({
          title,
          blocks: [
            { kind: "cover", eyebrow: "PROPOSAL", title, body: "Draft — not sent yet" },
            {
              kind: "text",
              label: "WHAT YOU TOLD US",
              title: "Put the conversation in your words",
              body: "Open this block and write what they said — nothing here is written for you.",
            },
            {
              kind: "price",
              label: "PRICING",
              title: "The price",
              options: [{ name: "The full plan", amount: amount || "—", best: true }],
            },
            { kind: "signature", label: "YOUR DECISION", body: "Signing arrives with delivery." },
          ],
        });
        if (!res.ok) throw new Error(res.error);
        setBuilt({ id: (res.body as { id: string }).id, title });
      } else {
        const trig = get("THE TRIGGER")!.value;
        const act = get("THE ACTION")!.value;
        const name = get("THE NAME")!.value.trim() || "New rule";
        const res = await createAutomation({
          name,
          enabled: true,
          trigger: TRIGGER_OF[trig]!,
          conditions: [],
          actions: [ACTION_OF[act]!],
        });
        if (!res.ok) throw new Error(res.error);
        setBuilt({ id: (res.body as { id: string }).id ?? null, title: name });
      }
    } catch (e) {
      flash((e as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    flash("Built — nothing goes live without you.");
  };

  const answer = (display: string, value: string) => {
    const all = [...answers, { step: step!, display, value }];
    setAnswers(all);
    setInputVal("");
    if (all.length === steps.length) void finish(all);
  };

  const locus = kind === "form" ? "Ada · forms" : kind === "proposal" ? "Ada · proposals" : "Ada · automations";
  const doneCta = kind === "form" ? "Open the form" : kind === "proposal" ? "Open the document" : "See it in the list";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,.16)", zIndex: 80 }} />
      <div data-testid="bold-gb" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 0, width: "min(640px, 94%)", height: "74%", background: "var(--cvb-card)", borderRadius: "22px 22px 0 0", border: "1px solid var(--cvb-line)", borderBottom: "none", zIndex: 81, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px" }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: "var(--cvb-gradient-signature, linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B))", flex: "none" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800 }}>Ada</div>
            <div style={{ ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-ghost)" }}>{locus.toUpperCase()}</div>
          </div>
          <span onClick={onClose} data-testid="bold-gb-close" style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-faint)", cursor: "pointer" }}>✕</span>
        </div>
        <div style={{ display: "flex", gap: 5, padding: "0 20px 14px" }}>
          {steps.map((s, i) => (
            <span key={s.label} style={{ flex: 1, height: 3, borderRadius: 2, background: i < idx || built ? "var(--cvb-forest)" : i === idx ? "var(--cvb-mint-line)" : "var(--cvb-line-inner)" }} />
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-inner)", borderRadius: "16px 16px 16px 5px", padding: "10px 13px", fontSize: 12.5, maxWidth: "85%" }}>{a.step.q}</div>
              <div style={{ background: "var(--cvb-forest)", color: "#fff", borderRadius: "16px 16px 5px 16px", padding: "10px 13px", fontSize: 12.5, fontWeight: 600, maxWidth: "70%", marginLeft: "auto", marginTop: 8 }}>{a.display}</div>
            </div>
          ))}
          {built ? (
            <div data-testid="bold-gb-done" style={{ background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-forest)" }}>READY</div>
              <div style={{ fontWeight: 900, fontSize: 18, marginTop: 8 }}>{built.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 6, lineHeight: 1.5 }}>
                {kind === "form"
                  ? "Saved as a draft — publish it from the form page when it looks right."
                  : kind === "proposal"
                    ? "Saved as a draft document — the words are yours to finish."
                    : "On, and watching the live event stream from this moment."}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <span onClick={() => onDone(kind, built.id)} data-testid="bold-gb-open" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }}>{doneCta}</span>
                <span onClick={() => { setAnswers([]); setBuilt(null); }} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }}>Start over</span>
              </div>
            </div>
          ) : step ? (
            <div>
              <div style={{ ...mono, fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-ghost)", marginBottom: 8 }}>
                {step.label} · {idx + 1} OF {steps.length}
              </div>
              <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-inner)", borderRadius: "16px 16px 16px 5px", padding: "10px 13px", fontSize: 12.5, maxWidth: "85%", marginBottom: 12 }}>{step.q}</div>
              {step.options
                ? step.options.map((o, oi) => (
                    <div key={o.value} onClick={() => answer(o.name, o.value)} data-testid={`bold-gb-opt-${oi}`} style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 16, padding: "15px 16px", marginBottom: 8, cursor: "pointer" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{o.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 2 }}>{o.sub}</div>
                    </div>
                  ))
                : null}
              {step.input ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder={step.input.placeholder}
                    data-testid={step.input.testId}
                    style={{ flex: 1, fontSize: 13, border: "1px solid var(--cvb-line-ctl)", borderRadius: 12, padding: "11px 13px" }}
                  />
                  <span
                    onClick={() => inputVal.trim() && !busy && answer(inputVal.trim(), inputVal.trim())}
                    data-testid="bold-gb-continue"
                    style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 16px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? "…" : "Continue"}
                  </span>
                </div>
              ) : null}
            </div>
          ) : busy ? (
            <div style={{ ...mono, fontSize: 10, color: "var(--cvb-ghost)" }}>building…</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
