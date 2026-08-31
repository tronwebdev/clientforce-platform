"use client";

/**
 * B9 (DEC-136): the first-run onboarding — the Business Core Onboarding
 * prototype's core wizard + plan step on the SHIPPED spines, mounted where
 * the minimal first-run modal used to be (the /bold layout's NO_WORKSPACE
 * state; Q-014's onboarding half, closed). Auth and the email code stay
 * the auth provider's own screens (Clerk / dev-login — Q-119).
 *
 * What each step WRITES (the scope map, live):
 *  - BUSINESS   → POST /workspaces {name, businessType, bold:true} — the one
 *    first-run bootstrap, extended additively: seeds the industry
 *    registries' interim home (Workspace.settings.icpProfile — the DEC-129
 *    vertical + DEC-131 shape) and flips consoleBold for the new workspace.
 *  - SITE       → POST /knowledge/sources {kind:WEBSITE} + POST /context/distill
 *    (workspace layer). Distilling needs the worker; the facts step POLLS
 *    the real status and never blocks — "she's still reading" is the
 *    honest state, and typed facts are always available.
 *  - FACTS      → GET /context (workspace layer); edits via POST
 *    /context/answers (typed beats distilled, the A4 rules).
 *  - ICP + GOAL → the icp context field (typed), then the FIRST CAMPAIGN as
 *    a DRAFT through the ONE create path (guardrail defaults apply;
 *    nothing sends — drafts are inert until launch).
 *  - QUESTION   → the goal's top open gap from the REAL gap report; skippable.
 *  - SENDER     → POST /senders (CF_MANAGED row + reply-to; the platform
 *    shared-mailer address derives from the workspace slug — SendGrid-side
 *    provisioning is platform config, the ROW is what onboarding owns).
 *  - PLAN       → GET /plans (agency-level tiers, D1 data; unconfirmed rows
 *    carry the PROPOSED chip per D2) + POST /plans/choose (records
 *    Agency.planTier; charged:false — the agency pays Clientforce, and
 *    with no platform Stripe key wired the card step renders its DEFERRED
 *    state naming the missing keys, never a fake form — Q-118).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mono } from "./bold-cards";

const step0 = { display: "block" } as const;
const eyebrow = { ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" } as const;
const input = {
  width: "100%",
  boxSizing: "border-box" as const,
  fontSize: 13.5,
  background: "var(--cvb-well)",
  border: "1px solid var(--cvb-line-ctl)",
  borderRadius: 12,
  padding: "12px 14px",
  outline: "none",
  color: "var(--cvb-ink)",
  fontFamily: "inherit",
} as const;
const cta = {
  display: "inline-block",
  fontSize: 13.5,
  fontWeight: 800,
  color: "#fff",
  background: "var(--cvb-forest)",
  borderRadius: 13,
  padding: "13px 20px",
  cursor: "pointer",
} as const;
const ghostLink = { fontSize: 12.5, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", cursor: "pointer" } as const;

async function post(path: string, body: unknown): Promise<{ ok: boolean; body?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/cf/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (parsed as { message?: string })?.message ?? `HTTP ${res.status}` };
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "network" };
  }
}
const getJson = async <T,>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(`/api/cf/${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

type Step = "business" | "site" | "facts" | "icp" | "goal" | "question" | "sender" | "done" | "plan";
/** The platform shared mailer's domain — the shipped `send.` subdomain
 *  rule (product mail never rides the root domain). */
const MANAGED_MAIL_DOMAIN = "send.clientforce.io";

const STEP_ORDER: Step[] = ["business", "site", "facts", "icp", "goal", "question", "sender", "done", "plan"];

const SHAPES: Array<[string, string, string]> = [
  ["local_business", "A local business", "You serve people nearby — a practice, salon, studio, shop."],
  ["company", "A company selling to companies", "Your customers are other businesses."],
  ["consumer", "Direct to consumers", "You sell to individuals wherever they are."],
];
const VERTICALS = ["dental", "salon", "fitness", "real_estate", "saas", "other"] as const;
const V_LABEL: Record<string, string> = {
  dental: "Dental",
  salon: "Salon & beauty",
  fitness: "Fitness & studio",
  real_estate: "Real estate",
  saas: "Software",
  other: "Something else",
};

const ICP_OPTIONS: Array<[string, string, string]> = [
  ["match", "People like your best customers", "She matches what you sell best — from your site and facts."],
  ["quiet", "Customers who went quiet", "The ones who bought or asked before and drifted."],
  ["inbound", "Anyone who asks", "Inbound-first: she works whoever reaches out."],
  ["describe", "Let me describe them", "Type who you want in your own words."],
];

const GOAL_OPTIONS: Array<[string, string, string]> = [
  ["generate_leads", "Qualify and hand over", "She finds and warms them; your team closes."],
  ["book_appointments", "Get meetings booked", "Calendar slots filled — her push is paced for shows."],
  ["drive_signups", "Take a payment or sign-up", "She walks them to a checkout or a form."],
  ["winback_deals", "Win back quiet accounts", "Careful, respectful re-opens of old threads."],
];

export function BoldOnboarding() {
  const [step, setStep] = useState<Step>("business");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [bizName, setBizName] = useState("");
  const [shape, setShape] = useState<string | null>(null);
  const [vertical, setVertical] = useState<string | null>(null);
  const [verticalOther, setVerticalOther] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [ctxStatus, setCtxStatus] = useState<"none" | "distilling" | "ready">("none");
  const [facts, setFacts] = useState<Array<{ key: string; label: string; value: string }>>([]);
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({});
  const [icpPick, setIcpPick] = useState<string | null>(null);
  const [icpText, setIcpText] = useState("");
  const [goalPick, setGoalPick] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [gap, setGap] = useState<{ key: string; label: string } | null>(null);
  const [gapAnswer, setGapAnswer] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [wsSlug, setWsSlug] = useState<string | null>(null);
  const [senderAddr, setSenderAddr] = useState<string | null>(null);
  // Review round: a failed gap read is NOT "no gaps", and a failed plans
  // read is NOT "no tiers" — both get their own honest state.
  const [gapsUnknown, setGapsUnknown] = useState(false);
  const [plansError, setPlansError] = useState(false);
  const [plans, setPlans] = useState<{
    current: string;
    tiers: Array<{ name: string; priceMonthlyCents: number; limits: Record<string, unknown>; proposal: boolean }>;
  } | null>(null);
  const [tierPick, setTierPick] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const idx = STEP_ORDER.indexOf(step);
  const coreSteps = 6; // business..sender
  const pct = Math.min(100, Math.round((Math.min(idx, coreSteps) / coreSteps) * 100));

  const FIELD_LABELS: Record<string, string> = {
    offer: "What you sell",
    pricing: "Prices she found",
    usp: "What makes you different",
    tone: "How you sound",
    company_address: "Where you are",
    icp: "Who you want",
  };

  const pollContext = useCallback(async () => {
    const ctx = await getJson<{
      workspace?: { status?: string; fields?: Record<string, { value?: string }> } | null;
    }>("context");
    const status = String(ctx?.workspace?.status ?? "").toLowerCase();
    setCtxStatus(status === "distilling" ? "distilling" : status === "ready" ? "ready" : "none");
    const fields = ctx?.workspace?.fields ?? {};
    setFacts(
      Object.entries(fields)
        .filter(([, v]) => ((v as { value?: string })?.value ?? "").trim().length > 0)
        .map(([key, v]) => ({ key, label: FIELD_LABELS[key] ?? key, value: (v as { value?: string }).value ?? "" })),
    );
  }, []);

  useEffect(() => {
    if (step !== "facts" && step !== "done") return;
    void pollContext();
    pollRef.current = setInterval(() => void pollContext(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, pollContext]);

  async function createWorkspace() {
    if (busy) return;
    const name = bizName.trim();
    if (name.length < 2) {
      setErr("Give the business a name first.");
      return;
    }
    if (!shape) {
      setErr("Pick what kind of business this is — it tunes her vocabulary everywhere.");
      return;
    }
    setBusy(true);
    setErr(null);
    const v = vertical === "other" ? verticalOther.trim() || undefined : (vertical ?? undefined);
    const res = await post("workspaces", {
      name,
      businessType: { shape, ...(v ? { vertical: v } : {}) },
      bold: true,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "That did not save — try again.");
      return;
    }
    // The SERVER owns the slug (it appends a uniqueness suffix), so the
    // sender step addresses the real workspace, never a client re-slug.
    setWsSlug(((res.body as { slug?: string })?.slug ?? "").trim() || null);
    setStep("site");
  }

  async function readSite() {
    if (busy) return;
    const url = siteUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      setErr("A full address, starting https://");
      return;
    }
    setBusy(true);
    setErr(null);
    const saved = await post("knowledge/sources", { kind: "WEBSITE", uri: url, label: url.replace(/^https?:\/\//, "") });
    if (!saved.ok) {
      setBusy(false);
      setErr(saved.error ?? "That address did not save — check it and try again.");
      return;
    }
    const started = await post("context/distill", {});
    setBusy(false);
    // A refused distill is not a silent one: the facts step says she has not
    // started reading rather than showing a reading state that is not running.
    setCtxStatus(started.ok ? "distilling" : "none");
    if (!started.ok) setErr("Saved your address, but she could not start reading it just now — type the facts below and she will pick the site up later.");
    setStep("facts");
  }

  async function saveFact(key: string) {
    const value = (factDrafts[key] ?? "").trim();
    if (!value) return;
    const res = await post("context/answers", { key, value });
    if (res.ok) {
      setFactDrafts((d) => ({ ...d, [key]: "" }));
      await pollContext();
    } else {
      setErr(res.error ?? "That did not save.");
    }
  }

  async function saveIcp() {
    if (busy) return;
    if (!icpPick) {
      setErr("Pick one — she needs to know who to work.");
      return;
    }
    const text =
      icpPick === "describe"
        ? icpText.trim()
        : icpPick === "match"
          ? "People like the customers this business already serves best."
          : icpPick === "quiet"
            ? "Past customers and enquirers who went quiet."
            : "Whoever reaches out — inbound-first.";
    if (icpPick === "describe" && !text) {
      setErr("A sentence or two about who you want.");
      return;
    }
    setBusy(true);
    setErr(null);
    const saved = await post("context/answers", { key: "icp", value: text });
    setBusy(false);
    if (!saved.ok) {
      setErr(saved.error ?? "That did not save — try again.");
      return;
    }
    setStep("goal");
  }

  async function saveGoal() {
    if (busy) return;
    if (!goalPick) {
      setErr("Pick the goal — it sets her pace and follow-up.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await post("agents", { name: `${bizName.trim()} — first push`, goal: goalPick });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "The draft did not save — try again.");
      return;
    }
    const id = (res.body as { id?: string })?.id ?? null;
    setAgentId(id);
    if (id) {
      const gaps = await getJson<{ gaps?: Array<{ key: string; label: string; status: string }> }>(
        `context/gaps?agentId=${encodeURIComponent(id)}&goal=${encodeURIComponent(goalPick)}`,
      );
      setGapsUnknown(gaps == null);
      const open = (gaps?.gaps ?? []).find((g) => g.status === "open");
      setGap(open ? { key: open.key, label: open.label } : null);
    }
    setStep("question");
  }

  async function saveGapAnswer(skip: boolean) {
    if (busy) return;
    if (!skip && gap && gapAnswer.trim()) {
      setBusy(true);
      const saved = await post("context/answers", { agentId: agentId ?? undefined, key: gap.key, value: gapAnswer.trim() });
      setBusy(false);
      if (!saved.ok) {
        setErr(saved.error ?? "That answer did not save — try again, or skip and she will ask in the moment.");
        return;
      }
    }
    setStep("sender");
  }

  async function createSender() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    // The shared mailer's address is the PLATFORM domain (the shipped
    // `send.` subdomain rule) with the SERVER's own workspace slug as the
    // local part — never a client re-slug, which the uniqueness suffix
    // would make wrong the moment two businesses share a name.
    const slug = (wsSlug ?? "").trim();
    if (!slug) {
      setBusy(false);
      setErr("Your workspace did not finish setting up — reload and start again.");
      return;
    }
    const fromEmail = `${slug}@${MANAGED_MAIL_DOMAIN}`;
    const res = await post("senders", {
      type: "CF_MANAGED",
      fromEmail,
      fromName: bizName.trim(),
      ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "The sender did not save — try again.");
      return;
    }
    setSenderAddr(fromEmail);
    setStep("done");
  }

  async function toPlan() {
    if (busy) return;
    setBusy(true);
    const p = await getJson<typeof plans>("plans");
    setBusy(false);
    setPlans(p);
    setPlansError(p == null);
    setTierPick(p?.current ?? null);
    setStep("plan");
  }

  async function retryPlans() {
    if (busy) return;
    setBusy(true);
    const p = await getJson<typeof plans>("plans");
    setBusy(false);
    setPlans(p);
    setPlansError(p == null);
    setTierPick((cur) => cur ?? p?.current ?? null);
  }

  async function chooseTier() {
    if (busy || !tierPick) return;
    setBusy(true);
    const res = await post("plans/choose", { tier: tierPick });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "That did not save — try again.");
      return;
    }
    // ?welcome=1 hands off to the shell, which fires the product tour once
    // (B9 tour addendum) — a full navigation so the layout re-reads /me and
    // drops the first-run gate.
    window.location.href = "/bold?welcome=1";
  }

  /** Plan limits read as numbers a person reads: 10,000 · 100,000 · 1M.
   *  Grouped below a million, compact at or above it — the row's own value
   *  either way (D1), never a re-rounded stand-in. */
  const limitValue = (v: unknown): string => {
    if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
    if (Math.abs(v) >= 1_000_000) {
      const m = v / 1_000_000;
      return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
    }
    return v.toLocaleString("en-US");
  };

  // D1: show the row's number, not a rounded stand-in for it.
  const money = (cents: number) =>
    cents % 100 === 0
      ? `$${(cents / 100).toLocaleString("en-US")}`
      : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div data-testid="bold-onboarding" style={{ minHeight: "100vh", display: "flex", background: "var(--cvb-canvas,#F4F5F4)", fontFamily: "var(--cvb-font-ui, 'IBM Plex Sans', sans-serif)", color: "var(--cvb-ink,#101613)" }}>
      {/* Left rail — the Business Core assembling, factually. */}
      <div style={{ width: 320, flex: "none", background: "var(--cvb-card,#FCFCFC)", borderRight: "1px solid var(--cvb-line,#ECEDEC)", padding: "34px 28px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/bold/mark.svg" alt="" style={{ width: 30, height: 30 }} />
          <span style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-.03em" }}>Clientforce</span>
        </div>
        <div style={{ marginTop: 40 }}>
          <div style={eyebrow}>YOUR BUSINESS CORE</div>
          <div style={{ fontWeight: 900, fontSize: 26, letterSpacing: "-.032em", marginTop: 10 }}>{pct}% assembled</div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--cvb-panel,#F2F3F2)", overflow: "hidden", marginTop: 12 }}>
            <span style={{ display: "block", height: 6, width: `${pct}%`, background: "var(--cvb-forest,#146B33)", borderRadius: 3 }} />
          </div>
          <div data-testid="bold-onb-status" style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 14, lineHeight: 1.6 }}>
            {step === "business"
              ? "She starts from whatever you give her."
              : ctxStatus === "distilling"
                ? "Reading your site — facts land as she finds them."
                : ctxStatus === "ready"
                  ? `${facts.length} fact${facts.length === 1 ? "" : "s"} on file — typed answers always win.`
                  : "No site read yet — typed facts work just as well."}
          </div>
        </div>
        <div style={{ marginTop: 34, fontSize: 12.5, color: "var(--cvb-muted,#5A6660)", lineHeight: 1.6 }}>
          Nothing sends without your say-so. Every fact she uses is one you gave her or one she read — she will not invent the rest.
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-ghost,#B4BEB8)" }}>
          {step === "plan" ? "LAST STEP" : `STEP ${Math.min(idx + 1, coreSteps + 1)} OF ${coreSteps + 1}`}
        </div>
      </div>

      {/* Right — the step panel. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", overflowY: "auto" }}>
        <div style={{ width: "min(660px, 92%)", padding: "56px 0 64px" }}>
          {err ? (
            <div data-testid="bold-onb-error" style={{ marginBottom: 18, background: "#FBEEEA", border: "1px solid #F0D2CB", color: "#B0483A", borderRadius: 12, padding: "11px 14px", fontSize: 12.5 }}>
              {err}
            </div>
          ) : null}

          {step === "business" ? (
            <div style={step0}>
              <div style={eyebrow}>FIRST THINGS FIRST</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>What should she call the business?</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 22px" }}>
                The name goes on your workspace; the kind of business tunes her vocabulary on every surface.
              </p>
              <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Bright Smile Dental" data-testid="bold-onb-name" style={input} />
              <div style={{ ...eyebrow, margin: "26px 0 12px" }}>WHAT KIND OF BUSINESS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {SHAPES.map(([key, title, sub]) => (
                  <div
                    key={key}
                    onClick={() => setShape(key)}
                    data-testid={`bold-onb-shape-${key}`}
                    style={{ background: shape === key ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${shape === key ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 16, padding: 15, cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13.5, color: shape === key ? "var(--cvb-forest-ink,#0E3D22)" : "var(--cvb-ink)" }}>{title}</div>
                    <div style={{ fontSize: 11.5, color: shape === key ? "var(--cvb-forest)" : "var(--cvb-faint)", marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ ...eyebrow, margin: "22px 0 12px" }}>THE TRADE</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {VERTICALS.map((v) => (
                  <span
                    key={v}
                    onClick={() => setVertical(v)}
                    data-testid={`bold-onb-vertical-${v}`}
                    style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 999, cursor: "pointer", background: vertical === v ? "var(--cvb-mint)" : "var(--cvb-card)", color: vertical === v ? "var(--cvb-forest)" : "var(--cvb-muted)", border: `1px solid ${vertical === v ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}` }}
                  >
                    {V_LABEL[v]}
                  </span>
                ))}
              </div>
              {vertical === "other" ? (
                <input value={verticalOther} onChange={(e) => setVerticalOther(e.target.value)} placeholder="What do you do? One or two words." style={{ ...input, marginTop: 12 }} />
              ) : null}
              <div style={{ marginTop: 28 }}>
                <span onClick={() => void createWorkspace()} data-testid="bold-onb-create" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Setting up…" : "Create my workspace →"}
                </span>
              </div>
            </div>
          ) : null}

          {step === "site" ? (
            <div>
              <div style={eyebrow}>SKIP THE SETUP FORMS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Point her at your website</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 22px" }}>
                She reads what you sell, your prices, hours and how you sound — and you confirm before anything is used.
              </p>
              <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourbusiness.com" data-testid="bold-onb-site" style={input} />
              <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                <span onClick={() => void readSite()} data-testid="bold-onb-read" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Starting the read…" : "Read my site →"}
                </span>
                <span onClick={() => setStep("facts")} data-testid="bold-onb-nosite" style={ghostLink}>
                  No website? Tell her about the business instead →
                </span>
              </div>
            </div>
          ) : null}

          {step === "facts" ? (
            <div>
              <div style={eyebrow}>WHAT SHE KNOWS SO FAR</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Confirm the facts</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                {ctxStatus === "distilling"
                  ? "She's still reading — facts land here as she finds them. You can type the important ones now; typed answers always win."
                  : facts.length > 0
                    ? "From your site and your answers. Fix anything that's off — she quotes these."
                    : "Type the two that matter most — what you sell, and your prices. She will not invent either."}
              </p>
              {ctxStatus === "distilling" ? (
                <div data-testid="bold-onb-distilling" style={{ ...mono, fontSize: 10.5, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 10, padding: "8px 12px", marginBottom: 16, display: "inline-block" }}>
                  READING YOUR SITE…
                </div>
              ) : null}
              {facts.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 2px", borderBottom: "1px solid var(--cvb-line-inner,#F4F5F4)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.5 }}>{f.value}</div>
                  </div>
                </div>
              ))}
              <div style={{ ...eyebrow, margin: "20px 0 10px" }}>{facts.length ? "ADD OR CORRECT" : "THE TWO THAT MATTER"}</div>
              {["offer", "pricing"].map((key) => (
                <div key={key} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    value={factDrafts[key] ?? ""}
                    onChange={(e) => setFactDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    placeholder={key === "offer" ? "What you sell — one sentence" : "Prices — the ones she may quote"}
                    data-testid={`bold-onb-fact-${key}`}
                    style={{ ...input, flex: 1 }}
                  />
                  <span onClick={() => void saveFact(key)} style={{ ...cta, padding: "12px 15px", fontSize: 12.5 }}>
                    Save
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 22 }}>
                <span onClick={() => setStep("icp")} data-testid="bold-onb-facts-next" style={cta}>
                  Looks right →
                </span>
              </div>
            </div>
          ) : null}

          {step === "icp" ? (
            <div>
              <div style={eyebrow}>WHO SHE WORKS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 20px" }}>Who do you want more of?</h1>
              <div style={{ display: "grid", gap: 10 }}>
                {ICP_OPTIONS.map(([key, title, sub]) => (
                  <div
                    key={key}
                    onClick={() => setIcpPick(key)}
                    data-testid={`bold-onb-icp-${key}`}
                    style={{ background: icpPick === key ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${icpPick === key ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 16, padding: 16, cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
                    <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{sub}</div>
                  </div>
                ))}
              </div>
              {icpPick === "describe" ? (
                <textarea value={icpText} onChange={(e) => setIcpText(e.target.value)} placeholder="Adults 35+ within 15 miles who…" rows={3} style={{ ...input, marginTop: 12, resize: "vertical" }} />
              ) : null}
              <div style={{ marginTop: 24 }}>
                <span onClick={() => void saveIcp()} data-testid="bold-onb-icp-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  Continue →
                </span>
              </div>
            </div>
          ) : null}

          {step === "goal" ? (
            <div>
              <div style={eyebrow}>THE GOAL</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>What does a win look like?</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                The goal sets her pace, her follow-up and how she reads replies. It also names your first campaign — a draft, nothing sends.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {GOAL_OPTIONS.map(([key, title, sub]) => (
                  <div
                    key={key}
                    onClick={() => setGoalPick(key)}
                    data-testid={`bold-onb-goal-${key}`}
                    style={{ background: goalPick === key ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${goalPick === key ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 16, padding: 16, cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
                    <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 24 }}>
                <span onClick={() => void saveGoal()} data-testid="bold-onb-goal-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Drafting…" : "Continue →"}
                </span>
              </div>
            </div>
          ) : null}

          {step === "question" ? (
            <div>
              <div style={eyebrow}>SHE NEEDS THIS TO HIT THE GOAL</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>
                {gap
                  ? `One question: ${gap.label.toLowerCase()}`
                  : gapsUnknown
                    ? "Her gap report did not load"
                    : "Nothing missing right now"}
              </h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                {gap
                  ? "Skip it and she asks you in the moment instead — she never invents it."
                  : gapsUnknown
                    ? "We could not read what she still needs for this goal just now — carry on; she asks in the moment for anything missing, and the campaign page shows the gaps once it loads."
                    : "Her gap report is clear for this goal — anything new she needs, she asks in the moment."}
              </p>
              {gap ? (
                <input value={gapAnswer} onChange={(e) => setGapAnswer(e.target.value)} placeholder="Type it — a sentence is plenty" data-testid="bold-onb-gap" style={input} />
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                <span onClick={() => void saveGapAnswer(false)} data-testid="bold-onb-gap-next" style={cta}>
                  Continue →
                </span>
                {gap ? (
                  <span onClick={() => void saveGapAnswer(true)} style={ghostLink}>
                    Skip — she can ask later
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === "sender" ? (
            <div>
              <div style={eyebrow}>HOW SHE SENDS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Sending, ready now</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                The Clientforce mailer sends for you from day one — no DNS, no waiting. Your own domain plugs in later in Settings; SMS and
                calls attach there too, once you pick a number.
              </p>
              <div style={{ ...eyebrow, marginBottom: 8 }}>REPLIES GO TO</div>
              <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="you@yourbusiness.com" data-testid="bold-onb-replyto" style={input} />
              <div style={{ marginTop: 24 }}>
                <span onClick={() => void createSender()} data-testid="bold-onb-sender-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Setting up…" : "Turn sending on →"}
                </span>
              </div>
            </div>
          ) : null}

          {step === "done" ? (
            <div>
              <div style={eyebrow}>YOUR CORE IS LIVE</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>She's ready when you are</h1>
              <div data-testid="bold-onb-draftcard" style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, padding: 18, margin: "18px 0" }}>
                <div style={{ ...eyebrow }}>YOUR FIRST CAMPAIGN — DRAFT</div>
                <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em", marginTop: 8 }}>{bizName.trim()} — first push</div>
                <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", marginTop: 6, lineHeight: 1.6 }}>
                  Drafted around your goal. Open it in the console to finish the plan — <strong>nothing sends until you say so</strong>.
                </div>
              </div>
              {senderAddr ? (
                <div style={{ ...mono, fontSize: 10.5, color: "var(--cvb-faint)", marginBottom: 18 }}>
                  SENDING FROM {senderAddr.toUpperCase()} · REPLIES TO {(replyTo.trim() || "your inbox").toUpperCase()}
                </div>
              ) : null}
              <span onClick={() => void toPlan()} data-testid="bold-onb-toplan" style={cta}>
                Choose your plan →
              </span>
            </div>
          ) : null}

          {step === "plan" ? (
            <div>
              <div style={eyebrow}>LAST STEP</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Pick a plan</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                Your agency pays Clientforce — nothing is charged today, and your choice is recorded, not billed.
              </p>
              {plansError || (plans?.tiers ?? []).length === 0 ? (
                <div
                  data-testid="bold-onb-plans-unavailable"
                  style={{ background: "var(--cvb-well,#FAFBFA)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 16, padding: "15px 17px", fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.6 }}
                >
                  <strong>{plansError ? "The plans did not load." : "No plans are published yet."}</strong>{" "}
                  {plansError
                    ? "Nothing is wrong with your setup — this is our end. Try again, or open the console and pick a plan later in Settings."
                    : "Your agency's tiers are not set in billing yet, so there is nothing to choose today. Open the console — you can pick a plan the moment they are published."}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
                    {plansError ? (
                      <span onClick={() => void retryPlans()} data-testid="bold-onb-plans-retry" style={{ ...cta, padding: "10px 16px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>
                        {busy ? "Trying…" : "Try again"}
                      </span>
                    ) : null}
                    <span onClick={() => { window.location.href = "/bold?welcome=1"; }} data-testid="bold-onb-skip-plan" style={ghostLink}>
                      Open my console →
                    </span>
                  </div>
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                {(plans?.tiers ?? []).map((t) => (
                  <div
                    key={t.name}
                    onClick={() => setTierPick(t.name)}
                    data-testid={`bold-onb-tier-${t.name}`}
                    style={{ background: tierPick === t.name ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${tierPick === t.name ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 16, padding: 16, cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, flex: 1 }}>{t.name.charAt(0) + t.name.slice(1).toLowerCase()}</span>
                      {t.proposal ? (
                        <span data-testid={`bold-onb-tier-proposal-${t.name}`} style={{ fontSize: 9, fontWeight: 700, color: "var(--cvb-amber,#8A6D1A)", background: "var(--cvb-amber-bg,#F7EFDA)", border: "1px solid var(--cvb-amber-line,#EAD9A8)", borderRadius: 999, padding: "2px 7px" }}>
                          PROPOSED
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: "-.03em", marginTop: 8 }}>
                      {money(t.priceMonthlyCents)}
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cvb-faint)" }}>/mo</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 8, lineHeight: 1.6 }}>
                      {Object.entries(t.limits)
                        .map(([k, v]) => `${limitValue(v)} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`)
                        .join(" · ") || "limits set by your admin"}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)", marginTop: 10, lineHeight: 1.5 }}>
                Proposed prices become final when they are set in billing — you will never be charged a number you have not seen confirmed.
              </div>
              <div
                data-testid="bold-onb-card-deferred"
                style={{ marginTop: 20, background: "var(--cvb-well,#FAFBFA)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: "15px 17px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}
              >
                <strong>Card on file — on its way.</strong> Payments aren&rsquo;t switched on for this platform yet, so there is no card form
                to fill and nothing to charge. When billing lands, you&rsquo;ll add a card here and the trial clock starts then — never
                retroactively.
              </div>
              {(plans?.tiers ?? []).length > 0 ? (
                <div style={{ marginTop: 24 }}>
                  <span onClick={() => void chooseTier()} data-testid="bold-onb-finish" style={{ ...cta, opacity: busy || !tierPick ? 0.6 : 1 }}>
                    {busy ? "Saving…" : "Open my console →"}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
