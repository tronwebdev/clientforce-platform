"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Me } from "../../lib/types";
import { BoldAdaBar, BoldAdaPanel } from "./BoldAdaBar";
import { BoldDock } from "./BoldDock";
import { BoldRail } from "./BoldRail";
import { BoldTourLayer, BoldTourOffer, useBoldTour } from "./BoldTour";
import { BoldWsPicker } from "./BoldWsPicker";
import {
  FIXTURE_CAMPAIGNS,
  FIXTURE_SUGGESTIONS,
  SURFACE_TITLES,
  SURFACE_WAVE,
  TOUR_STEPS,
  adaContextFor,
  type BoldSurface,
} from "./bold-data";

/** Anchors present in the B0 shell — B1+ extend this as surfaces land. */
const B0_ANCHORS = new Set(["ws", "camps", "sugg", "core", "canvas", "ada", "dock"]);

/** Dock pages show the chat-bubble tail; rail-selected surfaces do not. */
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

/**
 * Console Bold — the B0 shell (three fixed columns, internally-scrolling
 * canvas). Shell contract per ADDENDUM_4_BOLD §1:
 * `height:100vh · overflow:hidden · padding:26px · flex · gap:18px` with
 * rail 228 / canvas flex:1 min-width:0 / dock 52 — the page NEVER scrolls.
 */
export function BoldShell({ me }: { me: Me }) {
  const [surface, setSurface] = useState<BoldSurface>("campaign");
  const [camp, setCamp] = useState("openday");
  const [railOpen, setRailOpen] = useState(true);
  const [choreo, setChoreo] = useState<"approach" | "recede" | null>(null);
  const [wsPick, setWsPick] = useState(false);
  const [adaOn, setAdaOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [tourOffer, setTourOffer] = useState(false);
  const [tailTop, setTailTop] = useState<number | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasColRef = useRef<HTMLDivElement | null>(null);

  const flash = useCallback((t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /* ------------------------------------------------------------------ tour */

  const tourSteps = useMemo(() => TOUR_STEPS.filter((s) => B0_ANCHORS.has(s.sel)), []);
  const applyPre = useCallback((pre: { surface?: BoldSurface; camp?: string }) => {
    if (pre.surface) setSurface(pre.surface);
    if (pre.camp) setCamp(pre.camp);
    setAdaOn(false);
    setWsPick(false);
    setTourOffer(false);
    try {
      localStorage.setItem(TOUR_OFFER_KEY, "1");
    } catch {
      /* private mode — the offer just reappears next visit */
    }
  }, []);
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
  }, []);
  const selectCampaign = useCallback((key: string) => {
    setSurface("campaign");
    setCamp(key);
    setAdaOn(false);
  }, []);

  const suggestions = FIXTURE_SUGGESTIONS.filter((g) => !dismissed[g.id]);
  const activeCamp = FIXTURE_CAMPAIGNS.find((c) => c.key === camp) ?? FIXTURE_CAMPAIGNS[0]!;
  const adaCtx = adaContextFor(surface, activeCamp.name);

  const onCampaign = surface === "campaign";
  const [eyebrow, title] =
    surface === "campaign" ? (["CAMPAIGN", activeCamp.name] as const) : SURFACE_TITLES[surface];
  const status = onCampaign ? activeCamp.status : null;
  const hasBack = surface === "camps";

  return (
    <div className="cvb-root" data-testid="bold-root">
      <BoldRail
        me={me}
        open={railOpen}
        surface={surface}
        camp={camp}
        suggestions={suggestions}
        onFocus={focusMode}
        onOpenRail={openRail}
        onOpenWsPicker={() => setWsPick(true)}
        onSelectCampaign={selectCampaign}
        onAllCampaigns={() => selectDock("camps")}
        onSelectSurface={selectDock}
        onStartSuggestion={() => flash("Campaign creation arrives with wave B1 — she keeps the idea warm")}
        onDismissSuggestion={(id) => {
          setDismissed((x) => ({ ...x, [id]: true }));
          flash("Dismissed — she will not re-suggest it");
        }}
      />

      <div className="cvb-canvas-col" ref={canvasColRef} data-choreo={choreo ?? undefined}>
        {tailTop != null ? <span className="cvb-canvas-tail" data-testid="bold-canvas-tail" style={{ top: tailTop }} /> : null}
        <div data-tour="canvas" className="cvb-canvas" data-testid="bold-canvas">
          <div className="cvb-canvas-head">
            {hasBack ? (
              <span
                role="button"
                aria-label="Back"
                onClick={() => selectCampaign(camp)}
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
            {/* B0 stub — each wave B1+ replaces its surface here. */}
            <div className="cvb-stub">
              <div className="cvb-stub-stage">
                <div className="cvb-stub-hairline" />
                <div className="cvb-stub-body">
                  <div className="cvb-eyebrow">PORT IN PROGRESS</div>
                  <div className="cvb-stub-title">{title}</div>
                  <div className="cvb-stub-copy">
                    The Bold shell (B0) carries the frame, rail, dock, Ada bar and tour. This surface arrives with its
                    own wave behind the same <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 12 }}>consoleBold</span> flag —
                    the legacy console is untouched until the flag flips.
                  </div>
                  <span className="cvb-stub-wave">{SURFACE_WAVE[surface]}</span>
                </div>
              </div>
            </div>
          </div>

          <BoldAdaBar ctx={adaCtx} onOpen={() => setAdaOn(true)} />

          {adaOn ? (
            <BoldAdaPanel
              ctx={adaCtx}
              onClose={() => setAdaOn(false)}
              onNoop={() => flash("Ada is wired from wave B1 — nothing was sent")}
            />
          ) : null}

          {wsPick ? (
            <BoldWsPicker
              me={me}
              onClose={() => setWsPick(false)}
              onNoop={(label) => flash(`${label} arrives with the agency wave (B10)`)}
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
