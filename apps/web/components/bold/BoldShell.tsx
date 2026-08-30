"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, MeNeedsResponse } from "@clientforce/core";
import { RECEPTIONIST_FLAG } from "@clientforce/core";
import type { Me } from "../../lib/types";
import { BoldAdaBar, BoldAdaPanel } from "./BoldAdaBar";
import { BoldActivityView } from "./BoldActivityView";
import { BoldCampaignsView } from "./BoldCampaignsView";
import { BoldCreateView } from "./BoldCreateView";
import { BoldDock } from "./BoldDock";
import { BoldDrawer, type BoldDrawerState } from "./BoldDrawer";
import { BoldContactsView } from "./BoldContactsView";
import { BoldInboxView } from "./BoldInboxView";
import { BoldOverview } from "./BoldOverview";
import { BoldPipelineView } from "./BoldPipelineView";
import { BoldPlanView } from "./BoldPlanView";
import { BoldSettingsTab } from "./BoldSettingsTab";
import { BoldSiteAgentView } from "./BoldSiteAgentView";
import { BoldReceptionistPanel } from "./BoldReceptionistPanel";
import { BoldRail } from "./BoldRail";
import { BoldGettingStartedDrawer, BoldHelpLauncher, BoldTourLayer, useBoldTour } from "./BoldTour";
import { BoldWsPicker } from "./BoldWsPicker";
import {
  fetchFlags,
  fetchWidgetOverview,
  fetchLiveCalls,
  type WidgetOverview, dismissSuggestion, fetchBoldAgents, sweepSuggestions,
  fetchGettingStarted, patchMeSettings, type GettingStartedResponse } from "./bold-live";
import { BoldLiveCallCard } from "./BoldLiveCallCard";
import { BoldFormsView } from "./BoldFormsView";
import { BoldProposalsView } from "./BoldProposalsView";
import { BoldAutomationsView } from "./BoldAutomationsView";
import { BoldGuidedBuild, type GuildKind } from "./BoldGuidedBuild";
import { BoldLeadFinderView } from "./BoldLeadFinderView";
import { BoldWsSettingsView } from "./BoldWsSettingsView";
import { BoldCreditsView } from "./BoldCreditsView";
import { BoldStatsView } from "./BoldStatsView";
import { BoldIntegrationsView } from "./BoldIntegrationsView";
import {
  SURFACE_TITLES,
  TOUR_STEPS,
  adaContextFor,
  type BoldSurface,
} from "./bold-data";

/** Anchors present in the shell — B9 adds needs/alwayson for the canon tour arc. */
const ANCHORS = new Set(["ws", "camps", "core", "canvas", "ada", "dock", "hero", "act", "tabs", "needs", "alwayson"]);

const DOCK_SURFACES = new Set<BoldSurface>([
  "rcp",
  "wsinbox",
  "contacts",
  "lead",
  "automations",
  "forms",
  "chatbot",
  "proposals",
  "analytics",
  "integrations",
  "wssettings",
]);

export type CampaignTab = "overview" | "pipeline" | "plan" | "inbox" | "stats" | "settings";
const TABS: Array<[CampaignTab, string]> = [
  ["overview", "Overview"],
  ["pipeline", "Pipeline"],
  ["plan", "Plan"],
  ["inbox", "Inbox"],
  ["stats", "Stats"],
  ["settings", "Settings"],
];

/**
 * Console Bold shell — B1 brought the campaign console live (rail · overview ·
 * activity · all-campaigns); B2 (DEC-105) brings the Pipeline, Plan and Inbox
 * tabs live on shipped reads. Stats/Settings still carry their wave stubs;
 * Ada proposals wait for their engine (Q-066 — nothing canned renders as live).
 */
export function BoldShell({
  me,
  initialAgents,
  needs,
}: {
  me: Me;
  initialAgents: AgentListItem[];
  needs: MeNeedsResponse | null;
}) {
  const [agents, setAgents] = useState<AgentListItem[]>(initialAgents);
  // Rail/list order: live → paused → draft (owner ruling, B1 review; the
  // prototype's order), stable within each group by the shipped createdAt desc.
  const STATUS_ORDER: Record<string, number> = useMemo(() => ({ ACTIVE: 0, PAUSED: 1, DRAFT: 2 }), []);
  const orderedAgents = useMemo(
    () => [...agents].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)),
    [agents, STATUS_ORDER],
  );
  const isSuggested = (a: AgentListItem) => a.status === "DRAFT" && a.suggestion != null && !a.suggestion.dismissedAt;
  const firstCampaign =
    orderedAgents.find((a) => a.status === "ACTIVE") ?? orderedAgents.find((a) => !isSuggested(a)) ?? null;
  const [surface, setSurface] = useState<BoldSurface>("campaign");
  const [widgetOverview, setWidgetOverview] = useState<WidgetOverview | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [rcpOpen, setRcpOpen] = useState(false);
  const [campId, setCampId] = useState<string | null>(firstCampaign?.id ?? null);
  const [tab, setTab] = useState<CampaignTab>("overview");
  const [railOpen, setRailOpen] = useState(true);
  const [choreo, setChoreo] = useState<"approach" | "recede" | null>(null);
  const [wsPick, setWsPick] = useState(false);
  const [adaOn, setAdaOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // B9 tour addendum (DEC-136): tour-seen persists per USER via /me/settings,
  // never a browser store. The ? launcher gates on it: unseen → start the
  // tour; seen → the getting-started drawer.
  const [tourSeen, setTourSeen] = useState(Boolean(me.user.settings?.tourSeen));
  const [helpDrawer, setHelpDrawer] = useState(false);
  const [checklist, setChecklist] = useState<GettingStartedResponse | "loading" | "error">("loading");
  const [tailTop, setTailTop] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<BoldDrawerState | null>(null);
  // B4.5 (DEC-128): the live-call presence — one card at a time; a dismissed
  // call stays dismissed for the session, and the receptionist pitch's
  // scripted preview rides the same card, clearly labeled.
  const [liveCallId, setLiveCallId] = useState<string | null>(null);
  const [callPreview, setCallPreview] = useState(false);
  const dismissedCallsRef = useRef<Set<string>>(new Set());
  // B5 (DEC-130): guided-build sheet + the live eyebrow counts.
  const [gb, setGb] = useState<GuildKind | null>(null);
  /** Bumped when a guided build lands — remounts the surface so the new row shows. */
  const [gbTick, setGbTick] = useState(0);
  const [formCounts, setFormCounts] = useState<{ n: number; responses: number } | null>(null);
  // B8 (DEC-135): the integrations eyebrow's live connected count.
  const [intCount, setIntCount] = useState<number | null>(null);
  const [propCount, setPropCount] = useState<number | null>(null);
  const [autoCounts, setAutoCounts] = useState<{ n: number; on: number } | null>(null);
  const onFormCounts = useCallback((n: number, responses: number) => setFormCounts({ n, responses }), []);
  const onAutoCounts = useCallback((n: number, on: number) => setAutoCounts({ n, on }), []);
  // B3a: live eyebrow counts reported by the workspace surfaces (null until
  // each view loads — the eyebrow never shows a canned number).
  const [wsInboxCount, setWsInboxCount] = useState<number | null>(null);
  const [contactCount, setContactCount] = useState<number | null>(null);
  // The drawer's "Message" hand-off: which contact the workspace inbox opens on.
  const [wsFocus, setWsFocus] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasColRef = useRef<HTMLDivElement | null>(null);

  const activeCamp = useMemo(
    () => orderedAgents.find((a) => a.id === campId) ?? orderedAgents[0] ?? null,
    [orderedAgents, campId],
  );

  const flash = useCallback((t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const refreshAgents = useCallback(() => {
    void fetchBoldAgents().then((rows) => {
      if (rows) setAgents(rows);
    });
  }, []);

  // B2.6 (DEC-110): fire the deterministic suggestion sweep once per load —
  // idempotent server-side; AGENT members 403 into the fail-soft path.
  useEffect(() => {
    void sweepSuggestions().then((res) => {
      if (res.ok) refreshAgents();
    });
  }, [refreshAgents]);

  // Non-dismissed Ada-suggested drafts — the ✦ block + camps-page rows.
  const suggestions = useMemo(
    () => orderedAgents.filter((a) => a.status === "DRAFT" && a.suggestion != null && !a.suggestion.dismissedAt),
    [orderedAgents],
  );
  const [resumeSuggestion, setResumeSuggestion] = useState<AgentListItem | null>(null);
  const startSuggestion = useCallback(
    (id: string) => {
      const row = suggestions.find((g) => g.id === id);
      if (!row) return;
      setResumeSuggestion(row);
      setSurface("newcamp");
      setAdaOn(false);
      setDrawer(null);
    },
    [suggestions],
  );
  const dismissSugg = useCallback(
    (id: string) => {
      void dismissSuggestion(id).then((res) => {
        if (!res.ok) {
          flash(res.error);
          return;
        }
        flash("Dismissed — she will not re-suggest it");
        refreshAgents();
      });
    },
    [flash, refreshAgents],
  );

  /* ------------------------------------------------------------------ tour */

  const tourSteps = useMemo(() => TOUR_STEPS.filter((s) => ANCHORS.has(s.sel)), []);
  const applyPre = useCallback(
    (pre: { surface?: BoldSurface; camp?: string; tab?: string }) => {
      if (pre.surface) setSurface(pre.surface);
      if (pre.tab) setTab(pre.tab as CampaignTab);
      setAdaOn(false);
      setWsPick(false);
      setDrawer(null);
      setHelpDrawer(false);
    },
    [],
  );
  // Finish and skip both mark the tour seen — replay stays one tap away in
  // the drawer, so a skip is a real answer, not a snooze.
  const endTour = useCallback(
    (message: string) => {
      setTourSeen(true);
      void patchMeSettings({ tourSeen: true });
      flash(message);
    },
    [flash],
  );
  const tour = useBoldTour({ steps: tourSteps, onPre: applyPre, onFinish: endTour });
  const tourRef = useRef(tour);
  tourRef.current = tour;

  // First login: onboarding hands off with ?welcome=1 — fire the tour once,
  // then it collapses to the ? launcher. Seen users never re-trigger.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("welcome") !== "1") return;
    sp.delete("welcome");
    const qs = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (!me.user.settings?.tourSeen) {
      const t = setTimeout(() => tourRef.current.start(), 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  const onHelpClick = useCallback(() => {
    if (!tourSeen) {
      tourRef.current.start();
      return;
    }
    setHelpDrawer((v) => !v);
  }, [tourSeen]);

  // The drawer's done-states are server-derived on every open — never cached
  // across opens, never hard-coded.
  useEffect(() => {
    if (!helpDrawer) return;
    let on = true;
    setChecklist("loading");
    void fetchGettingStarted().then((r) => {
      if (on) setChecklist(r ?? "error");
    });
    return () => {
      on = false;
    };
  }, [helpDrawer]);

  /* --------------------------------------------- chat tail (dock pages only) */

  const measureTail = useCallback(() => {
    const col = canvasColRef.current;
    if (!col || !DOCK_SURFACES.has(surface)) {
      setTailTop(null);
      return;
    }
    const tile = document.querySelector(`[data-dock-key="${surface}"]`);
    if (!tile) {
      setTailTop(null);
      return;
    }
    const tr = tile.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    setTailTop(Math.round(tr.top + tr.height / 2 - 9.5 - cr.top));
  }, [surface]);

  useEffect(() => {
    measureTail();
    window.addEventListener("resize", measureTail);
    return () => window.removeEventListener("resize", measureTail);
  }, [measureTail]);

  /* ------------------------------------------------------------- shell state */

  const focusMode = useCallback(() => {
    setRailOpen(false);
    setChoreo("approach");
  }, []);
  const openRail = useCallback(() => {
    setRailOpen(true);
    setChoreo("recede");
  }, []);
  useEffect(() => {
    let alive = true;
    void fetchWidgetOverview().then((o) => alive && setWidgetOverview(o));
    void fetchFlags().then((f) => alive && setFlags(f));
    return () => {
      alive = false;
    };
  }, []);

  // B4.5 (DEC-128): the live feed — the shell's 5s poll (the A4 convention).
  // The card keeps its own 2s detail poll once mounted, and it OUTLIVES the
  // feed row: a call that just ended leaves the feed while the card shows
  // its handled state until the user is done with it.
  useEffect(() => {
    let alive = true;
    const sweep = async () => {
      const res = await fetchLiveCalls();
      if (!alive || !res) return;
      const next = res.calls.find((c) => c.caller === "ada" && !dismissedCallsRef.current.has(c.id));
      if (next) setLiveCallId((cur) => cur ?? next.id);
    };
    void sweep();
    const iv = setInterval(() => {
      void sweep();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const selectDock = useCallback((key: BoldSurface) => {
    // B4 (DEC-124): the receptionist opens as the prototype's slide-over
    // panel from every entry point — never a canvas surface.
    if (key === "rcp") {
      // Gated on the receptionist flag (the B4 wave gate): without it the
      // add-on's pitch row stays, but the panel says so honestly.
      if (flags.includes(RECEPTIONIST_FLAG)) {
        setRcpOpen(true);
      } else {
        flash("The receptionist add-on isn't switched on for this workspace yet.");
      }
      setAdaOn(false);
      setDrawer(null);
      return;
    }
    setSurface(key);
    setAdaOn(false);
    setDrawer(null);
  }, [flags, flash]);
  const selectCampaign = useCallback((id: string) => {
    setSurface("campaign");
    setCampId(id);
    setTab("overview");
    setAdaOn(false);
    setDrawer(null);
  }, []);

  const onCampaign = surface === "campaign" && activeCamp != null;
  const adaCtx = adaContextFor(surface, activeCamp?.name ?? "your campaign");

  const [eyebrow, title] =
    surface === "campaign"
      ? activeCamp
        ? (["CAMPAIGN", activeCamp.name] as const)
        : (["CAMPAIGN", "No campaigns yet"] as const)
      : surface === "camps"
        ? // A suggestion isn't a campaign until started (owner ruling, B2.6
          // review) — both counts exclude undismissed suggestions; the ✦
          // blocks carry them.
          ([
            `${agents.length - suggestions.length} CAMPAIGN${agents.length - suggestions.length === 1 ? "" : "S"}`,
            "Campaigns",
          ] as const)
        : surface === "activity"
          ? ([`AGENT ACTIVITY · ${activeCamp?.name ?? ""}`, "Everything Ada did"] as const)
          : surface === "wsinbox"
            ? // B3a: live counts, never the prototype's fixture numbers.
              ([
                wsInboxCount == null
                  ? "WORKSPACE"
                  : `WORKSPACE · ${wsInboxCount} CONVERSATION${wsInboxCount === 1 ? "" : "S"}`,
                "Inbox",
              ] as const)
            : surface === "contacts"
              ? ([contactCount == null ? "PEOPLE" : `${contactCount} ${contactCount === 1 ? "PERSON" : "PEOPLE"}`, "Contacts"] as const)
              : surface === "chatbot"
                ? // B4 (DEC-124): the one-flag rule — the eyebrow flips with
                  // the SAME overview truth the page, rail and dock read.
                  ([
                    widgetOverview
                      ? widgetOverview.installed
                        ? "INBOUND CHANNEL · ON YOUR SITE"
                        : "INBOUND CHANNEL · NOT INSTALLED"
                      : "INBOUND CHANNEL",
                    "Site agent",
                  ] as const)
                : surface === "forms"
                  ? // B5 (DEC-130): live counts or nothing — never a canned number.
                    ([
                      formCounts ? `${formCounts.n} FORM${formCounts.n === 1 ? "" : "S"} · ${formCounts.responses} RESPONSE${formCounts.responses === 1 ? "" : "S"}` : "FORMS",
                      "Forms",
                    ] as const)
                  : surface === "proposals"
                    ? ([propCount == null ? "DOCUMENTS" : `${propCount} DOCUMENT${propCount === 1 ? "" : "S"}`, "Proposals"] as const)
                    : surface === "automations"
                      ? ([autoCounts ? `${autoCounts.n} RULE${autoCounts.n === 1 ? "" : "S"} · ${autoCounts.on} ON` : "RULES", "Automations"] as const)
                      : surface === "integrations"
                        ? ([intCount == null ? "WORKSPACE" : `${intCount} CONNECTED`, "Integrations"] as const)
                        : SURFACE_TITLES[surface];
  const status =
    onCampaign && activeCamp
      ? activeCamp.status === "ACTIVE"
        ? { label: "Live", tone: "live" as const }
        : activeCamp.status === "PAUSED"
          ? { label: "Paused", tone: "capped" as const }
          : { label: "Draft", tone: "idle" as const }
      : null;
  const hasBack = surface === "camps" || surface === "activity";

  return (
    <div className="cvb-root" data-testid="bold-root">
      <BoldRail
        me={me}
        open={railOpen}
        agents={orderedAgents}
        suggestions={suggestions}
        onStartSuggestion={startSuggestion}
        onDismissSuggestion={dismissSugg}
        activeCampId={onCampaign ? (activeCamp?.id ?? null) : null}
        needs={needs}
        onFocus={focusMode}
        onOpenRail={openRail}
        onOpenWsPicker={() => setWsPick(true)}
        onSelectCampaign={selectCampaign}
        onAllCampaigns={() => selectDock("camps")}
        onSelectSurface={selectDock}
        widgetOverview={widgetOverview}
      />

      <div className="cvb-canvas-col" ref={canvasColRef} data-choreo={choreo ?? undefined}>
        {tailTop != null ? <span className="cvb-canvas-tail" data-testid="bold-canvas-tail" style={{ top: tailTop }} /> : null}
        <div data-tour="canvas" className="cvb-canvas" data-testid="bold-canvas" style={{ position: "relative" }}>
          {/* B4.5 (DEC-128): the live-call card — a real call, or the pitch's
              labeled preview; the prototype's top-right float, one at a time. */}
          {callPreview ? (
            <BoldLiveCallCard mode={{ kind: "preview" }} onClose={() => setCallPreview(false)} flash={flash} />
          ) : liveCallId ? (
            <BoldLiveCallCard
              mode={{ kind: "live", callId: liveCallId }}
              onClose={() => {
                dismissedCallsRef.current.add(liveCallId);
                setLiveCallId(null);
              }}
              flash={flash}
            />
          ) : null}
          <div className="cvb-canvas-head">
            {hasBack ? (
              <span
                role="button"
                aria-label="Back"
                onClick={() => (activeCamp ? selectCampaign(activeCamp.id) : selectDock("camps"))}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  border: "1px solid var(--cvb-line-ctl)",
                  background: "var(--cvb-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--cvb-muted)",
                  fontSize: 15,
                  cursor: "pointer",
                  flex: "none",
                  marginTop: 12,
                }}
              >
                ←
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cvb-eyebrow">{eyebrow}</div>
              <div className="cvb-page-title" data-testid="bold-page-title">
                {title}
              </div>
            </div>
            {status ? (
              <span className="cvb-status-pill" data-tone={status.tone}>
                {status.label}
              </span>
            ) : null}
          </div>

          <div className="cvb-canvas-scroll" data-testid="bold-canvas-scroll">
            {onCampaign && activeCamp ? (
              <>
                {/* Tab frame — Overview live in B1; the rest carry their wave. */}
                <div data-tour="tabs" style={{ display: "flex", gap: 22, padding: "20px 40px 0", borderBottom: "1px solid var(--cvb-line-inner)", flexWrap: "wrap" }}>
                  {TABS.map(([k, l]) => (
                    <span
                      key={k}
                      onClick={() => setTab(k)}
                      data-testid={`bold-tab-${k}`}
                      style={{
                        fontSize: 14,
                        fontWeight: tab === k ? 800 : 500,
                        letterSpacing: "-.018em",
                        color: tab === k ? "var(--cvb-ink)" : "var(--cvb-faint)",
                        paddingBottom: 14,
                        borderBottom: `2px solid ${tab === k ? "var(--cvb-forest)" : "transparent"}`,
                        cursor: "pointer",
                        marginBottom: -1,
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                {tab === "overview" ? (
                  <BoldOverview
                    agent={activeCamp}
                    onOpenDrawer={setDrawer}
                    onAllActivity={() => setSurface("activity")}
                    onValueSaved={refreshAgents}
                    onOpenInbox={() => setTab("inbox")}
                    flash={flash}
                  />
                ) : tab === "pipeline" ? (
                  <BoldPipelineView agent={activeCamp} onOpenDrawer={setDrawer} flash={flash} />
                ) : tab === "plan" ? (
                  <BoldPlanView agent={activeCamp} flash={flash} />
                ) : tab === "inbox" ? (
                  <BoldInboxView scope={{ kind: "campaign", agent: activeCamp }} onOpenDrawer={setDrawer} flash={flash} meId={me.user.id} />
                ) : tab === "settings" ? (
                  <BoldSettingsTab agent={activeCamp} flash={flash} />
                ) : tab === "stats" ? (
                  <BoldStatsView agentId={activeCamp.id} />
                ) : (
                  <SurfaceStub title={`${activeCamp.name} — ${TABS.find(([k]) => k === tab)?.[1] ?? ""}`} />
                )}
              </>
            ) : null}
            {surface === "wsinbox" ? (
              <BoldInboxView
                key={wsFocus ?? "ws"}
                scope={{ kind: "workspace", focusContactId: wsFocus }}
                onOpenDrawer={setDrawer}
                flash={flash}
                onThreadCount={setWsInboxCount}
                meId={me.user.id}
              />
            ) : null}
            {surface === "contacts" ? <BoldContactsView onOpenDrawer={setDrawer} flash={flash} onCount={setContactCount} /> : null}
            {surface === "campaign" && !activeCamp ? (
              <div style={{ textAlign: "center", padding: "80px 40px" }}>
                <div className="cvb-display" style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em" }}>No campaigns yet</div>
                <span
                  role="button"
                  onClick={() => selectDock("newcamp")}
                  style={{
                    display: "inline-block",
                    marginTop: 18,
                    fontSize: 12.5,
                    fontWeight: 800,
                    color: "var(--cvb-card)",
                    background: "var(--cvb-forest)",
                    borderRadius: 12,
                    padding: "11px 17px",
                    cursor: "pointer",
                  }}
                >
                  New campaign
                </span>
              </div>
            ) : null}
            {surface === "camps" ? (
              <BoldCampaignsView
                agents={orderedAgents}
                suggestions={suggestions}
                onSelect={selectCampaign}
                onNew={() => {
                  setResumeSuggestion(null);
                  selectDock("newcamp");
                }}
                onStartSuggestion={startSuggestion}
              />
            ) : null}
            {surface === "newcamp" ? (
              <BoldCreateView
                key={resumeSuggestion?.id ?? "new"}
                resume={
                  resumeSuggestion
                    ? {
                        agentId: resumeSuggestion.id,
                        goal: resumeSuggestion.goal,
                        name: resumeSuggestion.name,
                        summary: resumeSuggestion.goalSummary,
                      }
                    : null
                }
                onCancel={() => {
                  setResumeSuggestion(null);
                  selectDock("camps");
                }}
                onLaunched={(id) => {
                  setResumeSuggestion(null);
                  refreshAgents();
                  selectCampaign(id);
                }}
                flash={flash}
              />
            ) : null}
            {surface === "activity" && activeCamp ? <BoldActivityView agentId={activeCamp.id} onOpenDrawer={setDrawer} /> : null}
            {surface === "chatbot" ? <BoldSiteAgentView flash={flash} /> : null}
            {surface === "forms" ? (
              <BoldFormsView key={`f${gbTick}`} onOpenDrawer={setDrawer} onBuild={() => setGb("form")} onCounts={onFormCounts} flash={flash} />
            ) : null}
            {surface === "proposals" ? (
              <BoldProposalsView key={`p${gbTick}`} onBuild={() => setGb("proposal")} onCounts={setPropCount} flash={flash} />
            ) : null}
            {surface === "automations" ? (
              <BoldAutomationsView key={`a${gbTick}`} onBuild={() => setGb("auto")} onCounts={onAutoCounts} flash={flash} />
            ) : null}
            {surface === "lead" ? <BoldLeadFinderView onOpenDrawer={setDrawer} flash={flash} /> : null}
            {surface === "wssettings" ? (
              <BoldWsSettingsView onOpenCredits={() => setSurface("credits")} flash={flash} />
            ) : null}
            {surface === "credits" ? <BoldCreditsView /> : null}
            {surface === "analytics" ? <BoldStatsView /> : null}
            {surface === "integrations" ? <BoldIntegrationsView flash={flash} onCount={setIntCount} /> : null}
            {gb ? (
              <BoldGuidedBuild
                kind={gb}
                agents={agents}
                onClose={() => setGb(null)}
                onDone={() => {
                  setGb(null);
                  setGbTick((t) => t + 1);
                }}
                flash={flash}
              />
            ) : null}
            {surface !== "campaign" && surface !== "camps" && surface !== "activity" && surface !== "newcamp" && surface !== "wsinbox" && surface !== "contacts" && surface !== "chatbot" && surface !== "forms" && surface !== "proposals" && surface !== "automations" && surface !== "lead" && surface !== "wssettings" && surface !== "credits" && surface !== "analytics" && surface !== "integrations" ? (
              <SurfaceStub title={title} />
            ) : null}
            {rcpOpen ? (
              <BoldReceptionistPanel
                onClose={() => setRcpOpen(false)}
                onPreview={() => {
                  // The prototype's handoff: the drawer gets out of the way
                  // and the card rises in the canvas.
                  setRcpOpen(false);
                  setCallPreview(true);
                }}
              />
            ) : null}
          </div>

          <BoldAdaBar ctx={adaCtx} onOpen={() => setAdaOn(true)} />

          {adaOn ? (
            <BoldAdaPanel ctx={adaCtx} onClose={() => setAdaOn(false)} onNoop={() => flash("Ada can't answer here yet — nothing was sent")} />
          ) : null}
          {wsPick ? (
            <BoldWsPicker me={me} onClose={() => setWsPick(false)} onNoop={(label) => flash(`${label} — coming soon`)} />
          ) : null}
          {drawer ? (
            <BoldDrawer
              state={drawer}
              onClose={() => setDrawer(null)}
              flash={flash}
              onMessage={(contactId) => {
                setDrawer(null);
                setWsFocus(contactId);
                selectDock("wsinbox");
              }}
            />
          ) : null}

          {toast ? (
            <div className="cvb-toast" data-testid="bold-toast">
              <span style={{ color: "var(--cvb-live)", fontSize: 13 }}>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cvb-card)" }}>{toast}</span>
            </div>
          ) : null}
        </div>
      </div>

      <BoldDock surface={surface} onSelect={selectDock} widgetOverview={widgetOverview} />

      {tour.index != null && tour.rect ? (
        <BoldTourLayer steps={tourSteps} index={tour.index} rect={tour.rect} onGo={tour.go} onSkip={tour.stop} />
      ) : null}
      {/* After the layer in the DOM so the ? stays visible through the dim —
          the final step points at it. */}
      <BoldHelpLauncher onClick={onHelpClick} />
      {helpDrawer && tour.index == null ? (
        <BoldGettingStartedDrawer
          checklist={checklist}
          onClose={() => setHelpDrawer(false)}
          onStartTour={() => {
            setHelpDrawer(false);
            tourRef.current.start();
          }}
        />
      ) : null}
    </div>
  );
}

/** Quiet stage card for areas that are not built yet — plain owner-facing
 *  copy only (owner ruling, B3a review: build ids and process vocabulary
 *  never render; the jargon lint rule enforces this). */
function SurfaceStub({ title }: { title: string }) {
  return (
    <div className="cvb-stub">
      <div className="cvb-stub-stage">
        <div className="cvb-stub-hairline" />
        <div className="cvb-stub-body">
          <div className="cvb-eyebrow">COMING SOON</div>
          <div className="cvb-stub-title">{title}</div>
          <div className="cvb-stub-copy">
            This area is on its way. Everything already live keeps working in the meantime.
          </div>
        </div>
      </div>
    </div>
  );
}
