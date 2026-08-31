"use client";

/**
 * B9 (DEC-136, revised by DEC-137): the first-run onboarding — the Business
 * Core Onboarding prototype on the SHIPPED spines, mounted where the minimal
 * first-run modal used to be (the /bold layout's NO_WORKSPACE state; Q-014's
 * onboarding half, closed). Auth and the email code stay the auth provider's
 * own screens (Clerk / dev-login — Q-119).
 *
 * THE REVISED ARC (owner canon, 2026-08-31): business → site *or* tell-her →
 * read-back → goal → audience → the one ask → [contacts, only when an
 * own-book audience is picked] → replies → done. The step count is computed
 * from the assembled flow, never hard-coded: the conditional step renumbers
 * everything after it, and the left-rail checklist grows the matching row.
 *
 * What each step WRITES (the scope map, live):
 *  - BUSINESS   → POST /workspaces {name, businessType, bold:true} — the one
 *    first-run bootstrap, extended additively: seeds the industry registries'
 *    interim home (Workspace.settings.icpProfile — the DEC-129 vertical +
 *    DEC-131 shape) and flips consoleBold for the new workspace.
 *  - SITE       → POST /knowledge/sources {kind:WEBSITE} + POST /context/distill.
 *    TELL-HER    → typed answers + REAL document upload (POST
 *    /knowledge/sources/upload — Azure Blob + the worker's extract/chunk/embed,
 *    the same KnowledgeChunk table the distiller reads, so a price list feeds
 *    her exactly like a website). Images/scans are refused by the server and
 *    filed (Q-123); the picker accepts only what the server takes.
 *  - READ-BACK  → GET /context; each fact states its SOURCE (the site + how
 *    many documents, or "what you told her"). Edits via POST /context/answers
 *    (typed beats distilled, the A4 rule).
 *  - GOAL       → the goal key; changing it clears the audience picks.
 *  - AUDIENCE   → REGISTRY-DERIVED (packages/core `audience.ts`): the goal's
 *    scope filters the options, its max caps them, 2+ picks name a primary.
 *    Written as the typed `icp` answer, primary first — the durable home
 *    Ada reads. The FIRST CAMPAIGN is drafted here through the ONE create
 *    path, for the primary. Extra picks becoming Ada suggestions needs a
 *    suggestion-write path that does not ship (engine-only) — Q-124.
 *  - ASK        → the goal's top open gap from the REAL gap report; skippable.
 *  - CONTACTS   → the SHARED B2.5 CSV mapper, mounted as-is. Consent is the
 *    DEC-108(4) truth and nothing more: rows without consent import as
 *    contacts and are held out of sending (durable message-consent is Q-125).
 *  - SENDER     → POST /senders (CF_MANAGED row; the shared-mailer address is
 *    the platform `send.` domain + the SERVER's workspace slug).
 *  - PLAN       → GET /plans (D1 data; unconfirmed rows carry PROPOSED per D2)
 *    + POST /plans/choose (charged:false — no platform Stripe key, Q-118).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  audienceLabel,
  audienceOptionsFor,
  goalAudienceOf,
  isOwnBookAudience,
  signalNounFor,
  type IcpShape,
} from "@clientforce/core";
import { mono } from "./bold-cards";
import { BoldCsvImport, type CsvImportOutcome } from "./shared/BoldCsvImport";

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
const card = {
  background: "var(--cvb-card)",
  border: "1px solid var(--cvb-line-ctl)",
  borderRadius: 15,
  padding: "15px 17px",
} as const;

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

type Step = "business" | "site" | "read" | "goal" | "audience" | "ask" | "import" | "send" | "done" | "plan";

/** The platform shared mailer's domain — the shipped `send.` subdomain rule
 *  (product mail never rides the root domain). */
const MANAGED_MAIL_DOMAIN = "send.clientforce.io";
/** Exactly what the server's upload gate takes — never promise more (Q-123). */
const DOC_ACCEPT = ".pdf,.docx,.xlsx,.txt,.csv,.md";

const SHAPES: Array<[IcpShape, string, string]> = [
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
/** The read-back's industry sentence when nothing distilled says otherwise. */
const V_INDUSTRY: Record<string, string> = {
  dental: "Dental practice",
  salon: "Salon and beauty studio",
  fitness: "Fitness and training studio",
  real_estate: "Real-estate practice",
  saas: "Software company",
};

/** Goal cards — copy verbatim from the canon prototype's GOALS registry.
 *  Keys are the SHIPPED goal keys; the proto's short keys (lead/book/sell/
 *  revive) are display aliases. The sell/revive mapping contradicts DEC-109's
 *  locked ten→key map and is filed as Q-121 — this round keeps what shipped
 *  rather than re-mapping inside a fixes-only round. */
const GOAL_OPTIONS: Array<[string, string, string]> = [
  ["generate_leads", "Qualify and hand over", "She works them, sorts them, your team closes"],
  ["book_appointments", "Get meetings booked", "Demos, calls, consults — time in the diary"],
  ["drive_signups", "Take payment or sign-up", "Checkout, trial start, subscription — a closed sale"],
  ["winback_deals", "Win back quiet accounts", "Revenue from customers you already have"],
];
const goalLabel = (k: string | null) => GOAL_OPTIONS.find(([key]) => key === k)?.[1] ?? "";

/** The one thing she cannot guess, per goal — the proto's ASK table. */
const ASK_COPY: Record<string, [string, string]> = {
  book_appointments: ["When can people actually meet you, and how long does it take?", "e.g. 20 minutes · weekdays and Saturday mornings"],
  drive_signups: ["What is the price, and what does it include?", "e.g. $249/mo — all seats, onboarding included"],
  winback_deals: ["What would bring a lapsed customer back?", "e.g. two months free, no setup charge"],
  generate_leads: ["What makes a lead worth your team's time?", "e.g. 10+ seats, evaluating this quarter"],
};

export function BoldOnboarding() {
  const [step, setStep] = useState<Step>("business");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [bizName, setBizName] = useState("");
  const [shape, setShape] = useState<IcpShape | null>(null);
  const [vertical, setVertical] = useState<string | null>(null);
  const [verticalOther, setVerticalOther] = useState("");
  const [wsSlug, setWsSlug] = useState<string | null>(null);

  // Site step — two modes; "tell her instead" is a real screen, not a skip.
  const [mode, setMode] = useState<"site" | "manual">("site");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteHost, setSiteHost] = useState<string | null>(null);
  const [mkind, setMkind] = useState("");
  const [msell, setMsell] = useState("");
  const [marea, setMarea] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [uploadCfg, setUploadCfg] = useState<{ enabled: boolean; reason?: string } | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);

  const [ctxStatus, setCtxStatus] = useState<"none" | "distilling" | "ready">("none");
  const [facts, setFacts] = useState<Array<{ key: string; label: string; value: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const [goalPick, setGoalPick] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [describeText, setDescribeText] = useState("");

  const [agentId, setAgentId] = useState<string | null>(null);
  const [gap, setGap] = useState<{ key: string; label: string } | null>(null);
  const [gapAnswer, setGapAnswer] = useState("");
  const [gapsUnknown, setGapsUnknown] = useState(false);

  const [imported, setImported] = useState<CsvImportOutcome | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [senderAddr, setSenderAddr] = useState<string | null>(null);

  const [plans, setPlans] = useState<{
    current: string;
    tiers: Array<{ name: string; priceMonthlyCents: number; limits: Record<string, unknown>; proposal: boolean }>;
  } | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [tierPick, setTierPick] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------------------------------------------------- the computed flow */

  // The contacts step exists only when a picked AUDIENCE draws on the
  // workspace's own records — not merely when the goal leans that way.
  const needsImport = picks.some(isOwnBookAudience);
  const flow: Step[] = [
    "business",
    "site",
    "read",
    "goal",
    "audience",
    "ask",
    ...(needsImport ? (["import"] as Step[]) : []),
    "send",
  ];
  const stepNo = flow.indexOf(step);
  const stepLabel =
    step === "plan" ? "LAST STEP" : step === "done" ? "YOUR CORE IS LIVE" : `STEP ${stepNo + 1} OF ${flow.length}`;
  const goNext = (from: Step) => {
    const i = flow.indexOf(from);
    setStep(i >= 0 && i + 1 < flow.length ? flow[i + 1]! : "done");
  };

  const audience = goalAudienceOf(goalPick);
  const options = audienceOptionsFor(audience.scope);

  /* ------------------------------------------------------------ the reads */

  const FIELD_LABELS: Record<string, string> = {
    offer: "What you sell",
    pricing: "Prices she found",
    usp: "What makes you different",
    tone: "How you sound",
    hours: "Hours",
    company_address: "Where you work",
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
    if (step !== "read" && step !== "done") return;
    void pollContext();
    pollRef.current = setInterval(() => void pollContext(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, pollContext]);

  // Document upload is a real shipped spine; the affordance renders live or
  // disabled from the server's own config, never as a promise.
  useEffect(() => {
    if (step !== "site" || uploadCfg) return;
    void getJson<{ enabled?: boolean; reason?: string }>("knowledge/upload-config").then((c) =>
      setUploadCfg({ enabled: Boolean(c?.enabled), ...(c?.reason ? { reason: c.reason } : {}) }),
    );
  }, [step, uploadCfg]);

  /* ----------------------------------------------------------- the writes */

  async function createWorkspace() {
    if (busy) return;
    const name = bizName.trim();
    if (name.length < 2) return setErr("Give the business a name first.");
    if (!shape) return setErr("Pick what kind of business this is — it tunes her vocabulary everywhere.");
    setBusy(true);
    setErr(null);
    const v = vertical === "other" ? verticalOther.trim() || undefined : (vertical ?? undefined);
    const res = await post("workspaces", { name, businessType: { shape, ...(v ? { vertical: v } : {}) }, bold: true });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "That did not save — try again.");
    // The SERVER owns the slug (it appends a uniqueness suffix), so the sender
    // step addresses the real workspace, never a client re-slug.
    setWsSlug(((res.body as { slug?: string })?.slug ?? "").trim() || null);
    setStep("site");
  }

  async function uploadDoc(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // RAW fetch: the JSON post() helper would corrupt the multipart boundary.
      const res = await fetch("/api/cf/knowledge/sources/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setErr(body?.message ?? "She could not read that file — PDF, Word, Excel, text, CSV or Markdown.");
        return;
      }
      setDocs((d) => [...d, file.name]);
    } catch {
      setErr("That upload did not go through — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function readSite() {
    if (busy) return;
    const url = siteUrl.trim();
    if (!/^https?:\/\//.test(url) && !/^[\w-]+(\.[\w-]+)+/.test(url)) {
      return setErr("A web address — yourbusiness.com is enough.");
    }
    const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
    const host = full.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    setBusy(true);
    setErr(null);
    const saved = await post("knowledge/sources", { kind: "WEBSITE", uri: full, label: host });
    if (!saved.ok) {
      setBusy(false);
      return setErr(saved.error ?? "That address did not save — check it and try again.");
    }
    const started = await post("context/distill", {});
    setBusy(false);
    setSiteHost(host);
    setCtxStatus(started.ok ? "distilling" : "none");
    if (!started.ok) setNote("Saved your address, but she could not start reading it just now — type the facts below and she picks the site up later.");
    setStep("read");
  }

  /** The "tell her instead" path: typed facts are real context answers, and
   *  any uploaded document is read the same way a site is. */
  async function tellHer() {
    if (busy) return;
    if (!msell.trim()) return setErr("The one line she cannot do without: what you sell, and roughly what it costs.");
    setBusy(true);
    setErr(null);
    // SEQUENTIALLY, not in parallel: every answer upserts the same
    // workspace-layer BusinessContext row, and concurrent writes collide.
    const writes: Array<[string, string]> = [["offer", msell.trim()]];
    if (mkind.trim()) writes.push(["usp", mkind.trim()]);
    if (marea.trim()) writes.push(["company_address", marea.trim()]);
    for (const [key, value] of writes) {
      const saved = await post("context/answers", { key, value });
      if (!saved.ok) {
        setBusy(false);
        return setErr(saved.error ?? "That did not save — try again.");
      }
    }
    // Documents only become facts once she reads them.
    if (docs.length > 0) {
      const started = await post("context/distill", {});
      setCtxStatus(started.ok ? "distilling" : "none");
      if (!started.ok) setNote("Your documents are saved — she could not start reading them just now, and picks them up later.");
    }
    setBusy(false);
    setStep("read");
  }

  async function saveFactEdit(key: string) {
    const value = editDraft.trim();
    if (!value) return setEditing(null);
    setBusy(true);
    const res = await post("context/answers", { key, value });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "That did not save.");
    setEditing(null);
    setEditDraft("");
    await pollContext();
  }

  function pickGoal(key: string) {
    // Changing the goal clears the picks — a different goal offers a
    // different set, and a stale pick would be a lie about the brief.
    setGoalPick(key);
    setPicks([]);
    setPrimary(null);
    setImported(null);
    setErr(null);
  }

  function togglePick(key: string) {
    setErr(null);
    setPicks((cur) => {
      if (cur.includes(key)) {
        const left = cur.filter((k) => k !== key);
        setPrimary((p) => (p === key ? (left[0] ?? null) : p));
        return left;
      }
      if (cur.length >= audience.max) {
        setErr(`This goal carries up to ${audience.max} audiences — deselect one to swap.`);
        return cur;
      }
      setPrimary((p) => p ?? key);
      return [...cur, key];
    });
  }

  /** The audience sentence Ada actually reads — primary first, in words. */
  function audienceSentence(): string {
    const ordered = [primary, ...picks.filter((k) => k !== primary)].filter(Boolean) as string[];
    const parts = ordered.map((k) =>
      k === "describe" && describeText.trim() ? describeText.trim() : audienceLabel(k),
    );
    if (parts.length === 0) return "";
    const [first, ...rest] = parts;
    return rest.length ? `${first} (primary). Also: ${rest.join("; ")}.` : `${first}.`;
  }

  async function saveAudience() {
    if (busy) return;
    if (picks.length === 0) return setErr("Pick at least one — she writes differently for each.");
    if (picks.includes("describe") && !describeText.trim()) {
      return setErr("A sentence or two about who you want.");
    }
    setBusy(true);
    setErr(null);
    const saved = await post("context/answers", { key: "icp", value: audienceSentence() });
    if (!saved.ok) {
      setBusy(false);
      return setErr(saved.error ?? "That did not save — try again.");
    }
    // The first campaign is drafted here: goal AND primary audience are known,
    // so the brief is complete. Nothing sends — drafts are inert.
    const res = await post("agents", { name: `${bizName.trim()} — first push`, goal: goalPick });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "The draft did not save — try again.");
    const id = (res.body as { id?: string })?.id ?? null;
    setAgentId(id);
    if (id && goalPick) {
      const gaps = await getJson<{ gaps?: Array<{ key: string; label: string; status: string }> }>(
        `context/gaps?agentId=${encodeURIComponent(id)}&goal=${encodeURIComponent(goalPick)}`,
      );
      setGapsUnknown(gaps == null);
      const open = (gaps?.gaps ?? []).find((g) => g.status === "open");
      setGap(open ? { key: open.key, label: open.label } : null);
    }
    goNext("audience");
  }

  async function saveGapAnswer(skip: boolean) {
    if (busy) return;
    if (!skip && gap && gapAnswer.trim()) {
      setBusy(true);
      const saved = await post("context/answers", { agentId: agentId ?? undefined, key: gap.key, value: gapAnswer.trim() });
      setBusy(false);
      if (!saved.ok) {
        return setErr(saved.error ?? "That answer did not save — try again, or skip and she will ask in the moment.");
      }
    }
    goNext("ask");
  }

  async function createSender() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const slug = (wsSlug ?? "").trim();
    if (!slug) {
      setBusy(false);
      return setErr("Your workspace did not finish setting up — reload and start again.");
    }
    const fromEmail = `${slug}@${MANAGED_MAIL_DOMAIN}`;
    const res = await post("senders", {
      type: "CF_MANAGED",
      fromEmail,
      fromName: bizName.trim(),
      ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "The sender did not save — try again.");
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
    if (!res.ok) return setErr(res.error ?? "That did not save — try again.");
    // ?welcome=1 hands off to the shell, which fires the product tour once
    // (B9 tour addendum) — a full navigation so the layout re-reads /me.
    window.location.href = "/bold?welcome=1";
  }

  /* --------------------------------------------------------- the read-back */

  /** Industry rides into the core as a fact of its own: whatever she
   *  distilled if there is one, else the registry's word for the trade. */
  const industryFact = (() => {
    const distilled = facts.find((f) => f.key === "industry");
    if (distilled) return distilled.value;
    const v = vertical === "other" ? verticalOther.trim() : vertical;
    if (!v) return "";
    return V_INDUSTRY[v] ?? v.replace(/_/g, " ");
  })();

  const readRows = [
    ...(industryFact ? [{ key: "industry", label: "Industry", value: industryFact }] : []),
    ...facts.filter((f) => f.key !== "industry" && f.key !== "icp"),
  ];

  /** Every fact states where it came from — facts with no stated origin are a
   *  defect. Documents count in both modes; she reads them the same way. */
  const sourceLine = (() => {
    const d = docs.length ? ` · ${docs.length} ${docs.length === 1 ? "document" : "documents"}` : "";
    if (mode === "manual") return `From what you told her${d || " — add documents any time to deepen this"}`;
    return `Read from ${siteHost ?? "your site"}${d}`;
  })();

  /* ------------------------------------------------------- the signal line */

  // ICP-derived, shown only when a new-demand audience was picked — and only
  // when a real outside-world count exists. It does NOT today: the Apollo
  // adapter returns no warm signals, provider candidates carry intentWeight 0,
  // and the one live producer counts THIS workspace's own inbound events,
  // which is not an outside population (Q-105/Q-106, both OPEN). So the count
  // stays null and the line stays absent on every deployment — never a number
  // we cannot source. The NOUN comes from the shape registry when it lands
  // (Q-122), never hard-coded here.
  const newDemandPicked = picks.some((k) => !isOwnBookAudience(k) && k !== "describe");
  const outsideDemandCount: number | null = null;
  const signalNoun = shape ? signalNounFor(shape, vertical) : "";
  const signalLine =
    newDemandPicked && outsideDemandCount != null
      ? `${outsideDemandCount} ${signalNoun} near you this month`
      : null;

  /* ------------------------------------------------------------- the rail */

  const railRows: Array<{ n: string; v: string; at: Step }> = [
    { n: "Business & offer", v: facts.find((f) => f.key === "offer")?.value ?? industryFact, at: "read" },
    { n: "First goal", v: goalLabel(goalPick), at: "goal" },
    {
      n: "Who to chase",
      v: picks.length
        ? picks.length > 1
          ? `${audienceLabel(primary ?? picks[0]!)} + ${picks.length - 1} more`
          : audienceLabel(picks[0]!)
        : "",
      at: "audience",
    },
    { n: "Goal readiness", v: gapAnswer.trim() ? gapAnswer.trim().slice(0, 34) : "", at: "ask" },
    ...(needsImport
      ? [{ n: "Your contacts", v: imported ? `${imported.result.created} imported · ${imported.consented} contactable` : "", at: "import" as Step }]
      : []),
    { n: "Channels", v: senderAddr ? `Mailer · replies to ${replyTo.trim() || "you"}` : "", at: "send" },
  ];
  const reachedIdx = step === "done" || step === "plan" ? flow.length : stepNo;
  const rail = railRows.map((r) => {
    const reached = reachedIdx >= flow.indexOf(r.at);
    const done = reached && !!r.v;
    const gapRow = reached && !r.v;
    return { ...r, done, gapRow, shown: gapRow ? "Not set — she will ask when it comes up" : r.v };
  });
  const filled = rail.filter((r) => r.done).length;
  const pct = `${Math.round((filled / rail.length) * 100)}%`;

  const limitValue = (v: unknown): string => {
    if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
    if (Math.abs(v) >= 1_000_000) {
      const m = v / 1_000_000;
      return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
    }
    return v.toLocaleString("en-US");
  };
  const money = (cents: number) =>
    cents % 100 === 0
      ? `$${(cents / 100).toLocaleString("en-US")}`
      : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const flash = useCallback((m: string) => setNote(m), []);

  /* ------------------------------------------------------------- rendering */

  return (
    <div
      data-testid="bold-onboarding"
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--cvb-canvas,#F4F5F4)",
        fontFamily: "var(--cvb-font-ui, 'IBM Plex Sans', sans-serif)",
        color: "var(--cvb-ink,#101613)",
      }}
    >
      {/* Left rail — the Business Core assembling, factually. */}
      <div
        style={{
          width: 320,
          flex: "none",
          background: "var(--cvb-card,#FCFCFC)",
          borderRight: "1px solid var(--cvb-line,#ECEDEC)",
          padding: "34px 28px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 9, background: "var(--cvb-gradient-mark)", flex: "none" }} />
          <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.02em" }}>Clientforce</span>
        </div>
        <div style={{ ...eyebrow, marginTop: 30 }}>YOUR BUSINESS CORE</div>
        <div style={{ fontWeight: 900, fontSize: 26, letterSpacing: "-.03em", marginTop: 8 }}>{pct} assembled</div>
        <div style={{ height: 4, background: "var(--cvb-line-ctl)", borderRadius: 2, marginTop: 12, overflow: "hidden" }}>
          <div style={{ width: pct, height: "100%", background: "var(--cvb-forest)" }} />
        </div>

        <div data-testid="bold-onb-checklist" style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
          {rail.map((r) => (
            <div
              key={r.n}
              data-testid={`bold-onb-rail-${r.n.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--cvb-line-inner,#F4F5F4)" }}
            >
              <span
                style={{
                  width: 17,
                  height: 17,
                  flex: "none",
                  borderRadius: 6,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9.5,
                  fontWeight: 700,
                  marginTop: 1,
                  background: r.done ? "var(--cvb-mint)" : r.gapRow ? "var(--cvb-amber-bg,#F7EFDA)" : "var(--cvb-well)",
                  border: `1px solid ${r.done ? "var(--cvb-mint-line)" : r.gapRow ? "var(--cvb-amber-line,#EAD9A8)" : "var(--cvb-line-ctl)"}`,
                  color: r.done ? "var(--cvb-forest)" : "var(--cvb-amber,#8A6D1A)",
                }}
              >
                {r.done ? "✓" : r.gapRow ? "!" : ""}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{r.n}</div>
                {r.shown ? (
                  <div style={{ fontSize: 11.5, color: r.gapRow ? "var(--cvb-amber,#8A6D1A)" : "var(--cvb-faint)", marginTop: 2, lineHeight: 1.45 }}>
                    {r.shown}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div data-testid="bold-onb-status" style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: "auto", lineHeight: 1.6 }}>
          {stepLabel}
        </div>
      </div>

      {/* The step panel. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", padding: "48px 40px" }}>
        <div style={{ width: "100%", maxWidth: 660 }}>
          {err ? (
            <div
              data-testid="bold-onb-error"
              style={{ marginBottom: 18, background: "#FBEEEA", border: "1px solid #F0D2CB", color: "#B0483A", borderRadius: 12, padding: "11px 14px", fontSize: 12.5 }}
            >
              {err}
            </div>
          ) : null}
          {note ? (
            <div
              data-testid="bold-onb-note"
              style={{ marginBottom: 18, background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-muted)", borderRadius: 12, padding: "11px 14px", fontSize: 12.5 }}
            >
              {note}
            </div>
          ) : null}

          {/* ---------------------------------------------------- business */}
          {step === "business" ? (
            <div>
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
                    style={{
                      background: shape === key ? "var(--cvb-mint)" : "var(--cvb-card)",
                      border: `1px solid ${shape === key ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                      borderRadius: 16,
                      padding: 15,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13.5 }}>{title}</div>
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
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "8px 14px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: vertical === v ? "var(--cvb-mint)" : "var(--cvb-card)",
                      color: vertical === v ? "var(--cvb-forest)" : "var(--cvb-muted)",
                      border: `1px solid ${vertical === v ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                    }}
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

          {/* -------------------------------------------------------- site */}
          {step === "site" ? (
            <div>
              <div style={eyebrow}>{mode === "site" ? "SKIP THE SETUP FORMS" : "TELL HER YOURSELF"}</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>
                {mode === "site" ? "Point her at your website" : "Tell her about the business"}
              </h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 22px" }}>
                {mode === "site"
                  ? "Give Ada your address and she works out what you sell, what it costs and how you sound. Nothing to fill in by hand."
                  : "A few lines is enough to start. Add a price list, brochure or policy document and she reads those the same way she reads a site."}
              </p>

              {mode === "site" ? (
                <>
                  <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="yourbusiness.com" data-testid="bold-onb-site" style={input} />
                  <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 12, lineHeight: 1.55 }}>
                    She reads your pages once, then keeps what matters. Nothing is published or changed.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                    <span onClick={() => void readSite()} data-testid="bold-onb-read" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                      {busy ? "Starting the read…" : "Read my site →"}
                    </span>
                    <span onClick={() => { setMode("manual"); setErr(null); }} data-testid="bold-onb-nosite" style={ghostLink}>
                      No website? Tell her about the business instead →
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={eyebrow}>WHAT KIND OF BUSINESS</div>
                      <input value={mkind} onChange={(e) => setMkind(e.target.value)} placeholder="e.g. dental practice · SaaS · marketing agency" data-testid="bold-onb-mkind" style={{ ...input, marginTop: 7 }} />
                    </div>
                    <div>
                      <div style={eyebrow}>WHAT YOU SELL, AND ROUGHLY WHAT IT COSTS</div>
                      <textarea
                        value={msell}
                        onChange={(e) => setMsell(e.target.value)}
                        placeholder="e.g. Dental implants from $8,400, whitening kits at $249, free consults"
                        rows={3}
                        data-testid="bold-onb-msell"
                        style={{ ...input, marginTop: 7, resize: "vertical" }}
                      />
                    </div>
                    <div>
                      <div style={eyebrow}>WHERE YOU WORK</div>
                      <input value={marea} onChange={(e) => setMarea(e.target.value)} placeholder="e.g. Austin, TX — 20 miles · or nationwide" data-testid="bold-onb-marea" style={{ ...input, marginTop: 7 }} />
                    </div>
                  </div>

                  <input
                    ref={docRef}
                    type="file"
                    accept={DOC_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadDoc(f);
                      e.target.value = "";
                    }}
                  />
                  {docs.length === 0 ? (
                    <div
                      onClick={() => uploadCfg?.enabled && docRef.current?.click()}
                      data-testid="bold-onb-doc-drop"
                      style={{
                        background: "var(--cvb-well)",
                        border: "1.5px dashed var(--cvb-line-ctl)",
                        borderRadius: 15,
                        padding: 18,
                        marginTop: 12,
                        textAlign: "center",
                        cursor: uploadCfg?.enabled ? "pointer" : "default",
                        opacity: uploadCfg && !uploadCfg.enabled ? 0.72 : 1,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.015em" }}>Add a price list, brochure or policy</div>
                      <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 5, lineHeight: 1.5 }}>
                        {uploadCfg && !uploadCfg.enabled
                          ? `Uploads are not switched on for this deployment${uploadCfg.reason ? ` — ${uploadCfg.reason}` : ""}. Type the lines above instead; documents can be added later from Business core.`
                          : "PDF, Word, Excel, text, CSV or Markdown. She reads it the same way she reads a website."}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => uploadCfg?.enabled && docRef.current?.click()}
                      data-testid="bold-onb-docs"
                      style={{ display: "flex", alignItems: "center", gap: 11, ...card, marginTop: 12, cursor: "pointer" }}
                    >
                      <span style={{ width: 26, height: 26, flex: "none", borderRadius: 9, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 11 }}>
                        ✓
                      </span>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>
                        {docs.length === 1 ? `1 document read — ${docs[0]}` : `${docs.length} documents read — ${docs.join(", ")}`}
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", flex: "none" }}>Add another</span>
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                    <span onClick={() => void tellHer()} data-testid="bold-onb-tellher" style={{ ...cta, opacity: busy || !msell.trim() ? 0.6 : 1 }}>
                      {busy ? "Saving…" : "Build my core →"}
                    </span>
                    <span onClick={() => { setMode("site"); setErr(null); }} data-testid="bold-onb-havesite" style={ghostLink}>
                      Actually, I do have a website →
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* ---------------------------------------------------- read-back */}
          {step === "read" ? (
            <div>
              <div style={eyebrow}>WHAT SHE KNOWS SO FAR</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>This is what she will say about you</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                Every message she writes comes from these facts. Change any of them and she keeps your version for good.
              </p>
              {ctxStatus === "distilling" ? (
                <div
                  data-testid="bold-onb-distilling"
                  style={{ ...mono, fontSize: 10.5, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 10, padding: "8px 12px", marginBottom: 16, display: "inline-block" }}
                >
                  {mode === "manual" ? "READING YOUR DOCUMENTS…" : "READING YOUR SITE…"}
                </div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {readRows.map((f) => (
                  <div key={f.key} data-testid={`bold-onb-fact-row-${f.key}`} style={{ display: "flex", alignItems: "flex-start", gap: 12, ...card }}>
                    <span style={{ width: 26, height: 26, flex: "none", borderRadius: 9, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 11 }}>
                      ✓
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...eyebrow }}>{f.label.toUpperCase()}</div>
                      {editing === f.key ? (
                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <input value={editDraft} onChange={(e) => setEditDraft(e.target.value)} data-testid={`bold-onb-fact-edit-${f.key}`} style={{ ...input, flex: 1 }} />
                          <span onClick={() => void saveFactEdit(f.key)} style={{ ...cta, padding: "10px 14px", fontSize: 12.5 }}>Save</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 5 }}>{f.value}</div>
                      )}
                    </div>
                    {editing === f.key ? null : (
                      <span
                        onClick={() => { setEditing(f.key); setEditDraft(f.value); }}
                        data-testid={`bold-onb-fact-change-${f.key}`}
                        style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", cursor: "pointer", flex: "none" }}
                      >
                        Change
                      </span>
                    )}
                  </div>
                ))}
                {readRows.length === 0 ? (
                  <div style={{ ...card, fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.6 }}>
                    {ctxStatus === "distilling"
                      ? "Nothing back yet — facts land here as she finds them. You can carry on; she keeps reading."
                      : "She has nothing on file yet. Carry on — she asks for what she needs, and never invents it."}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 13 }}>
                <span
                  data-testid="bold-onb-source"
                  style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}
                >
                  SOURCE
                </span>
                <span style={{ fontSize: 11.5, color: "var(--cvb-muted)" }}>{sourceLine}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 9, lineHeight: 1.55 }}>
                Add more any time — price lists, policies, documents — in Business core.
              </div>

              <div style={{ marginTop: 24 }}>
                <span onClick={() => goNext("read")} data-testid="bold-onb-read-next" style={cta}>
                  This is right →
                </span>
              </div>
            </div>
          ) : null}

          {/* -------------------------------------------------------- goal */}
          {step === "goal" ? (
            <div>
              <div style={eyebrow}>THE GOAL</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>What counts as a win?</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                Your first goal. It sets how hard she pushes, when she follows up and which replies get your attention.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {GOAL_OPTIONS.map(([key, title, sub]) => (
                  <div
                    key={key}
                    onClick={() => pickGoal(key)}
                    data-testid={`bold-onb-goal-${key}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      background: goalPick === key ? "var(--cvb-mint)" : "var(--cvb-card)",
                      border: `1px solid ${goalPick === key ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                      borderRadius: 15,
                      padding: "15px 17px",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", border: `1.5px solid ${goalPick === key ? "var(--cvb-forest)" : "var(--cvb-line-strong,#D4DAD6)"}`, background: goalPick === key ? "var(--cvb-forest)" : "transparent" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
                      <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24 }}>
                <span onClick={() => (goalPick ? goNext("goal") : setErr("Pick the goal — it sets her pace and follow-up."))} data-testid="bold-onb-goal-next" style={{ ...cta, opacity: goalPick ? 1 : 0.6 }}>
                  Continue →
                </span>
                <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)" }}>One goal now — add more campaigns whenever you like</span>
              </div>
            </div>
          ) : null}

          {/* ---------------------------------------------------- audience */}
          {step === "audience" ? (
            <div>
              <div style={eyebrow}>WHO SHE WORKS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Who is worth chasing?</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                She writes differently for each of these. Pick everyone worth the effort — up to {audience.max}.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {options.map((o) => {
                  const on = picks.includes(o.key);
                  const isP = on && picks.length > 1 && primary === o.key;
                  return (
                    <div
                      key={o.key}
                      onClick={() => togglePick(o.key)}
                      data-testid={`bold-onb-audience-${o.key}`}
                      data-picked={on ? "true" : "false"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 13,
                        background: on ? "var(--cvb-mint)" : "var(--cvb-card)",
                        border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                        borderRadius: 15,
                        padding: "15px 17px",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ width: 18, height: 18, flex: "none", borderRadius: 7, border: `1.5px solid ${on ? "var(--cvb-forest)" : "var(--cvb-line-strong,#D4DAD6)"}`, background: on ? "var(--cvb-forest)" : "transparent" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{o.label}</div>
                        <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{o.sub}</div>
                      </div>
                      {on && picks.length > 1 ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); setPrimary(o.key); }}
                          data-testid={`bold-onb-primary-${o.key}`}
                          style={{
                            fontSize: 10.5,
                            fontWeight: isP ? 700 : 600,
                            color: isP ? "var(--cvb-forest)" : "var(--cvb-faint)",
                            background: isP ? "var(--cvb-card)" : "transparent",
                            border: `1px solid ${isP ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                            borderRadius: 999,
                            padding: "4px 10px",
                            flex: "none",
                            cursor: isP ? "default" : "pointer",
                          }}
                        >
                          {isP ? "Primary" : "Make primary"}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {picks.includes("describe") ? (
                <textarea
                  value={describeText}
                  onChange={(e) => setDescribeText(e.target.value)}
                  placeholder="Adults 35+ within 15 miles who…"
                  rows={3}
                  data-testid="bold-onb-describe"
                  style={{ ...input, marginTop: 12, resize: "vertical" }}
                />
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24 }}>
                <span onClick={() => void saveAudience()} data-testid="bold-onb-audience-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Drafting…" : "Continue →"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)" }}>
                  {picks.length > 1
                    ? "Your primary gets the first campaign; the rest are saved to your core"
                    : "Add more audiences whenever you like"}
                </span>
              </div>
            </div>
          ) : null}

          {/* --------------------------------------------------------- ask */}
          {step === "ask" ? (
            <div>
              <div style={eyebrow}>SHE NEEDS THIS TO HIT THE GOAL</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>
                {gap ? "One thing she cannot guess" : gapsUnknown ? "Her gap report did not load" : "Nothing missing right now"}
              </h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                {gap
                  ? "Your site never says this, and she will not invent it. Without it she has to stall on a hot reply."
                  : gapsUnknown
                    ? "We could not read what she still needs for this goal just now — carry on; she asks in the moment for anything missing, and the campaign page shows the gaps once it loads."
                    : "Her gap report is clear for this goal — anything new she needs, she asks in the moment."}
              </p>
              {gap ? (
                <div style={{ background: "var(--cvb-amber-bg,#FDFBF4)", border: "1px solid var(--cvb-amber-line,#EFE6D0)", borderRadius: 16, padding: 18 }}>
                  <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-amber,#8A6D1A)" }}>{gap.label.toUpperCase()}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, marginTop: 8 }}>
                    {(ASK_COPY[goalPick ?? ""] ?? ASK_COPY.book_appointments)![0]}
                  </div>
                  <input
                    value={gapAnswer}
                    onChange={(e) => setGapAnswer(e.target.value)}
                    placeholder={(ASK_COPY[goalPick ?? ""] ?? ASK_COPY.book_appointments)![1]}
                    data-testid="bold-onb-gap"
                    style={{ ...input, marginTop: 12 }}
                  />
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                <span onClick={() => void saveGapAnswer(false)} data-testid="bold-onb-gap-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  Continue →
                </span>
                {gap ? (
                  <span onClick={() => void saveGapAnswer(true)} data-testid="bold-onb-gap-skip" style={ghostLink}>
                    Skip — she will ask you when it comes up →
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------------ import */}
          {step === "import" ? (
            <div>
              <div style={eyebrow}>YOUR OWN RECORDS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Bring your people with you</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                You picked an audience from your own records, so she needs the list. A spreadsheet is enough — she maps the columns herself.
              </p>
              {imported ? (
                <div data-testid="bold-onb-imported" style={{ display: "flex", alignItems: "center", gap: 12, ...card, padding: "17px 18px" }}>
                  <span style={{ width: 30, height: 30, flex: "none", borderRadius: 10, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 13 }}>
                    ✓
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.015em" }}>
                      {imported.result.created} contacts read · {imported.consented} she may contact
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.5 }}>
                      Rows without consent import as contacts only — they will not be contacted.
                      {imported.result.skippedDuplicates > 0 ? ` ${imported.result.skippedDuplicates} were already in your records.` : ""}
                      {imported.result.suppressed > 0 ? ` ${imported.result.suppressed} are on your suppression list and stay out.` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <BoldCsvImport onImported={(o) => setImported(o)} flash={flash} />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
                <span onClick={() => goNext("import")} data-testid="bold-onb-import-next" style={cta}>
                  Continue →
                </span>
                {imported ? null : (
                  <span onClick={() => goNext("import")} data-testid="bold-onb-import-skip" style={ghostLink}>
                    Skip — import later from Contacts →
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 14, lineHeight: 1.55 }}>
                Consent column respected — no consent, no sending.
              </div>
            </div>
          ) : null}

          {/* -------------------------------------------------------- send */}
          {step === "send" ? (
            <div>
              <div style={eyebrow}>HOW SHE SENDS</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Where should replies land?</h1>
              <p style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
                She sends from your Clientforce address today, so you can start now. Replies come straight back to you.
              </p>
              <div style={{ ...eyebrow, marginBottom: 8 }}>REPLIES GO TO</div>
              <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="you@yourbusiness.com" data-testid="bold-onb-replyto" style={input} />
              <div style={{ marginTop: 24 }}>
                <span onClick={() => void createSender()} data-testid="bold-onb-sender-next" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Setting up…" : "Finish setup →"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 14, lineHeight: 1.55 }}>
                Your own domain connects later, in settings. SMS and voice attach there too, once you pick a number.
              </div>
            </div>
          ) : null}

          {/* -------------------------------------------------------- done */}
          {step === "done" ? (
            <div>
              <div style={eyebrow}>YOUR CORE IS LIVE</div>
              <h1 style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-.034em", margin: "12px 0 8px" }}>Your first campaign is written</h1>
              <div data-testid="bold-onb-draftcard" style={{ ...card, borderRadius: 18, padding: 18, margin: "18px 0" }}>
                <div style={eyebrow}>YOUR FIRST CAMPAIGN — DRAFT</div>
                <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em", marginTop: 8 }}>{bizName.trim()} — first push</div>
                {picks.length ? (
                  <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--cvb-faint)", marginTop: 10 }}>
                    {picks.length > 1
                      ? `FOR ${audienceLabel(primary ?? picks[0]!).toUpperCase()} · ${picks.length - 1} MORE SAVED TO YOUR CORE`
                      : `FOR ${audienceLabel(picks[0]!).toUpperCase()}`}
                  </div>
                ) : null}
                <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", marginTop: 8, lineHeight: 1.6 }}>
                  Drafted around your goal. Open it in the console to finish the plan — <strong>nothing sends until you say so</strong>.
                </div>
              </div>
              {signalLine ? (
                <div data-testid="bold-onb-signal" style={{ display: "flex", alignItems: "center", gap: 12, ...card, marginBottom: 14 }}>
                  <span style={{ width: 28, height: 28, flex: "none", borderRadius: 9, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 12 }}>
                    ✦
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.015em" }}>{signalLine}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.5 }}>
                      She is already watching for moments like this that match your brief. Nobody is contacted until you say so.
                    </div>
                  </div>
                </div>
              ) : null}
              {senderAddr ? (
                <div style={{ ...mono, fontSize: 10.5, color: "var(--cvb-faint)", marginBottom: 18 }}>
                  SENDING FROM {senderAddr.toUpperCase()} · REPLIES TO {(replyTo.trim() || "your inbox").toUpperCase()}
                </div>
              ) : null}
              <span onClick={() => void toPlan()} data-testid="bold-onb-toplan" style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
                Choose your plan →
              </span>
            </div>
          ) : null}

          {/* -------------------------------------------------------- plan */}
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
                    style={{
                      background: tierPick === t.name ? "var(--cvb-mint)" : "var(--cvb-card)",
                      border: `1px solid ${tierPick === t.name ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                      borderRadius: 16,
                      padding: 16,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, flex: 1 }}>{t.name.charAt(0) + t.name.slice(1).toLowerCase()}</span>
                      {t.proposal ? (
                        <span
                          data-testid={`bold-onb-tier-proposal-${t.name}`}
                          style={{ fontSize: 9, fontWeight: 700, color: "var(--cvb-amber,#8A6D1A)", background: "var(--cvb-amber-bg,#F7EFDA)", border: "1px solid var(--cvb-amber-line,#EAD9A8)", borderRadius: 999, padding: "2px 7px" }}
                        >
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
              {(plans?.tiers ?? []).length > 0 ? (
                <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)", marginTop: 10, lineHeight: 1.5 }}>
                  Proposed prices become final when they are set in billing — you will never be charged a number you have not seen confirmed.
                </div>
              ) : null}
              <div
                data-testid="bold-onb-card-deferred"
                style={{ marginTop: 20, background: "var(--cvb-well,#FAFBFA)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: "15px 17px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}
              >
                <strong>Card on file — on its way.</strong> Payments aren&rsquo;t switched on for this platform yet, so there is no card form to fill and nothing to charge. When billing lands, you&rsquo;ll add a card here and the trial clock starts then — never retroactively.
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
