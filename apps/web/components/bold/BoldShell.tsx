"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, MeNeedsResponse } from "@clientforce/core";
import type { Me } from "../../lib/types";
import { BoldAdaBar, BoldAdaPanel } from "./BoldAdaBar";
import { BoldActivityView } from "./BoldActivityView";
import { BoldCampaignsView } from "./BoldCampaignsView";
import { BoldCreateView } from "./BoldCreateView";
import { BoldDock } from "./BoldDock";
import { BoldDrawer, type BoldDrawerState } from "./BoldDrawer";
import { BoldInboxView } from "./BoldInboxView";
import { BoldOverview } from "./BoldOverview";
import { BoldPipelineView } from "./BoldPipelineView";
import { BoldPlanView } from "./BoldPlanView";
import { BoldRail } from "./BoldRail";
import { BoldTourLayer, BoldTourOffer, useBoldTour } from "./BoldTour";
import { BoldWsPicker } from "./BoldWsPicker";
import { dismissSuggestion, fetchBoldAgents, sweepSuggestions } from "./bold-live";
import {
  SURFACE_TITLES,
  SURFACE_WAVE,
  TOUR_STEPS,
  adaContextFor,
  type BoldSurface,
} from "./bold-data";

/** Anchors present in the shell — B1 adds hero/act/tabs to B0's set. */
const ANCHORS = new Set(["ws", "camps", "core", "canvas", "ada", "dock", "hero", "act", "tabs"]);

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

const TOUR_OFFER_KEY = "cvb-tour-offer-dismissed";

export type CampaignTab = "overview" | "pipeline" | "plan" | "inbox" | "stats" | "settings";
const TABS: Array<[CampaignTab, string]> = [
  ["overview", "Overview"],
  ["pipeline", "Pipeline"],
  ["plan", "Plan"],
  ["inbox", "Inbox"],
  ["stats", "Stats"],
  ["settings", "Settings"],
];
/** Which wave delivers each not-yet-live tab (stub pill copy). */
const TAB_WAVE: Record<"stats" | "settings", string> = {
  stats: "B8 · analytics",
  settings: "B7 · settings waves",
};

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
  const [campId, setCampId] = useState<string | null>(firstCampaign?.id ?? null);
  const [tab, setTab] = useState<CampaignTab>("overview");
  const [railOpen, setRailOpen] = useState(true);
  const [choreo, setChoreo] = useState<"approach" | "recede" | null>(null);
  const [wsPick, setWsPick] = useState(false);
  const [adaOn, setAdaOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tourOffer, setTourOffer] = useState(false);
  const [tailTop, setTailTop] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<BoldDrawerState | null>(null);

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
      setTourOffer(false);
      try {
        localStorage.setItem(TOUR_OFFER_KEY, "1");
      } catch {
        /* private mode — the offer just reappears next visit */
      }
    },
    [],
  );
  const tour = useBoldTour({ steps: tourSteps, onPre: applyPre, onFinish: flash });

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_OFFER_KEY)) setTourOffer(true);
    } catch {
      setTourOffer(true);
    }
  }, []);
  const hideTourOffer = useCallback(() => {
    setTourOffer(false);
    try {
      localStorage.setItem(TOUR_OFFER_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

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
  const selectDock = useCallback((key: BoldSurface) => {
    setSurface(key);
    setAdaOn(false);
    setDrawer(null);
  }, []);
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
        ? ([`${agents.length} CAMPAIGN${agents.length === 1 ? "" : "S"}`, "Campaigns"] as const)
        : surface === "activity"
          ? ([`AGENT ACTIVITY · ${activeCamp?.name ?? ""}`, "Everything Ada did"] as const)
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
      />

      <div className="cvb-canvas-col" ref={canvasColRef} data-choreo={choreo ?? undefined}>
        {tailTop != null ? <span className="cvb-canvas-tail" data-testid="bold-canvas-tail" style={{ top: tailTop }} /> : null}
        <div data-tour="canvas" className="cvb-canvas" data-testid="bold-canvas">
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
            <button type="button" className="cvb-tour-btn" title="Take the tour" data-testid="bold-tour-btn" onClick={tour.start}>
              ?
            </button>
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
                    flash={flash}
                  />
                ) : tab === "pipeline" ? (
                  <BoldPipelineView agent={activeCamp} onOpenDrawer={setDrawer} flash={flash} />
                ) : tab === "plan" ? (
                  <BoldPlanView agent={activeCamp} flash={flash} />
                ) : tab === "inbox" ? (
                  <BoldInboxView agent={activeCamp} onOpenDrawer={setDrawer} flash={flash} />
                ) : (
                  <SurfaceStub title={`${activeCamp.name} — ${TABS.find(([k]) => k === tab)?.[1] ?? ""}`} wave={TAB_WAVE[tab as "stats" | "settings"]} />
                )}
              </>
            ) : null}
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
                onDismissSuggestion={dismissSugg}
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
            {surface !== "campaign" && surface !== "camps" && surface !== "activity" && surface !== "newcamp" ? (
              <SurfaceStub title={title} wave={SURFACE_WAVE[surface]} />
            ) : null}
          </div>

          <BoldAdaBar ctx={adaCtx} onOpen={() => setAdaOn(true)} />

          {adaOn ? (
            <BoldAdaPanel ctx={adaCtx} onClose={() => setAdaOn(false)} onNoop={() => flash("Ada can't answer here yet — nothing was sent")} />
          ) : null}
          {wsPick ? (
            <BoldWsPicker me={me} onClose={() => setWsPick(false)} onNoop={(label) => flash(`${label} — coming soon`)} />
          ) : null}
          {drawer ? <BoldDrawer state={drawer} onClose={() => setDrawer(null)} /> : null}

          {toast ? (
            <div className="cvb-toast" data-testid="bold-toast">
              <span style={{ color: "var(--cvb-live)", fontSize: 13 }}>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cvb-card)" }}>{toast}</span>
            </div>
          ) : null}
        </div>
      </div>

      <BoldDock surface={surface} onSelect={selectDock} />

      {tour.index != null && tour.rect ? (
        <BoldTourLayer steps={tourSteps} index={tour.index} rect={tour.rect} onGo={tour.go} onSkip={tour.stop} />
      ) : null}
      {tourOffer && tour.index == null ? (
        <BoldTourOffer stepCount={tourSteps.length} onStart={tour.start} onHide={hideTourOffer} />
      ) : null}
    </div>
  );
}

/** Quiet stage card for surfaces that arrive with a later wave. */
function SurfaceStub({ title, wave }: { title: string; wave: string }) {
  return (
    <div className="cvb-stub">
      <div className="cvb-stub-stage">
        <div className="cvb-stub-hairline" />
        <div className="cvb-stub-body">
          <div className="cvb-eyebrow">PORT IN PROGRESS</div>
          <div className="cvb-stub-title">{title}</div>
          <div className="cvb-stub-copy">
            The campaign console is live (B1). This surface arrives with its own wave behind the same{" "}
            <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 12 }}>consoleBold</span> flag — the legacy console is
            untouched until the flag flips.
          </div>
          <span className="cvb-stub-wave">{wave}</span>
        </div>
      </div>
    </div>
  );
}
