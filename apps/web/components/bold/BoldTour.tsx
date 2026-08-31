"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoldTourStep } from "./bold-data";
import type { GettingStartedResponse } from "./bold-live";

/**
 * Anchored product tour — spotlight ring + dodging card, rebuilt to the canon
 * tour prototype (Product Tour.dc.html, owner ruling 2026-08-30): 8 fixed
 * steps, pulsing brand-green ring over a dimmed frame, STEP N OF 8 card with
 * dots / Back / Next / Skip, and a ? launcher pinned bottom-right that turns
 * into the getting-started drawer once the tour has been seen.
 *
 * Geometry notes ported with the logic (each was a real defect during the
 * design build): scroll the anchor into its own scroll window before
 * measuring; clip the ring to what is actually visible; verify geometry, not
 * just text presence; a target filling most of the screen cannot be dodged —
 * seat the card bottom-centre over it. Targets are measured from the live
 * layout at runtime, never hard-coded px. A step whose anchor is not in the
 * DOM (e.g. the needs strip when nothing needs you) is skipped in the travel
 * direction rather than stranding the ring.
 */

export interface TourRect {
  /** The step index this geometry was measured for — the layer renders only
   *  when it matches the current step, so a card never sits over a stale ring. */
  step: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  big: boolean;
}

interface UseBoldTourOptions {
  steps: BoldTourStep[];
  /** Apply a step's `pre` state (surface/campaign switch) before measuring. */
  onPre: (pre: NonNullable<BoldTourStep["pre"]>) => void;
  onFinish: (message: string) => void;
}

export function useBoldTour({ steps, onPre, onFinish }: UseBoldTourOptions) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const indexRef = useRef<number | null>(null);
  const dirRef = useRef(1);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= steps.length) {
        indexRef.current = null;
        setIndex(null);
        setRect(null);
        onFinish("Tour finished — the ? button brings it back");
        return;
      }
      dirRef.current = i >= (indexRef.current ?? 0) ? 1 : -1;
      const pre = steps[i]?.pre;
      if (pre) onPre(pre);
      indexRef.current = i;
      setIndex(i);
    },
    [steps, onPre, onFinish],
  );

  const stop = useCallback(() => {
    indexRef.current = null;
    setIndex(null);
    setRect(null);
    onFinish("Tour closed — the ? button brings it back");
  }, [onFinish]);

  const measure = useCallback(() => {
    if (index == null) return;
    const step = steps[index];
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.sel}"]`);
    if (!el) return; // anchor not painted yet — a scheduled re-measure follows
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Bring the target inside its scroll container before measuring.
    let sc: HTMLElement | null = el.parentElement;
    while (sc && sc !== document.body) {
      const cs = getComputedStyle(sc);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && sc.scrollHeight > sc.clientHeight + 4) break;
      sc = sc.parentElement;
    }
    if (sc && sc === document.body) sc = null;
    if (sc) {
      const cr = sc.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (er.bottom > cr.bottom - 8 || er.top < cr.top + 8) {
        const want = er.top - cr.top - 22;
        sc.scrollTop = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + want));
      }
    }

    const box = (l: number, t: number, ri: number, b: number) => ({
      left: l,
      top: t,
      right: ri,
      bottom: b,
      width: ri - l,
      height: b - t,
    });
    const a0 = el.getBoundingClientRect();
    let r = box(a0.left, a0.top, a0.right, a0.bottom);
    if (step.grow && el.nextElementSibling) {
      const n2 = el.nextElementSibling.getBoundingClientRect();
      r = box(Math.min(r.left, n2.left), Math.min(r.top, n2.top), Math.max(r.right, n2.right), Math.max(r.bottom, n2.bottom));
    }
    // Never let the ring leave its scroll window — clip to what is visible.
    if (sc) {
      const c2 = sc.getBoundingClientRect();
      const t2 = Math.max(r.top, c2.top + 2);
      const b2 = Math.min(r.bottom, c2.bottom - 2);
      if (b2 - t2 > 30) r = box(r.left, t2, r.right, b2);
      else r = box(Math.max(r.left, c2.left + 2), c2.top + 2, Math.min(r.right, c2.right - 2), c2.bottom - 2);
    }
    r = box(Math.max(r.left, 8), Math.max(r.top, 8), Math.min(r.right, vw - 8), Math.min(r.bottom, vh - 8));

    const cEl = document.querySelector("[data-tour-card]") as HTMLElement | null;
    const cw = 330;
    const chH = Math.max(196, cEl ? cEl.offsetHeight + 8 : 240);
    const pad = 18;
    const clampY = (y: number) => Math.max(12, Math.min(y, vh - chH - 12));
    const clampX = (x: number) => Math.max(12, Math.min(x, vw - cw - 12));
    const hits = (x: number, y: number) => !(x + cw < r.left - 6 || x > r.right + 6 || y + chH < r.top - 6 || y > r.bottom + 6);

    const apply = (next: TourRect) => {
      setRect((cur) =>
        cur &&
        cur.step === next.step &&
        cur.x === next.x &&
        cur.y === next.y &&
        cur.w === next.w &&
        cur.h === next.h &&
        cur.cx === next.cx &&
        cur.cy === next.cy &&
        cur.big === next.big
          ? cur
          : next,
      );
    };

    // A target that fills most of the screen cannot be dodged.
    const big = r.width * r.height > vw * vh * 0.42;
    if (big) {
      apply({
        step: index,
        x: Math.round(r.left - 4),
        y: Math.round(r.top - 4),
        w: Math.round(r.width + 8),
        h: Math.round(r.height + 8),
        cx: Math.round((vw - cw) / 2),
        cy: Math.round(vh - chH - 18),
        big: true,
      });
      return;
    }
    const cands: Array<[number, number]> = [
      [r.right + pad, clampY(r.top)],
      [r.left - cw - pad, clampY(r.top)],
      [clampX(r.left), r.bottom + pad],
      [clampX(r.left), r.top - chH - pad],
      [clampX(vw - cw - 12), clampY(vh - chH - 12)],
      [12, clampY(12)],
    ];
    let pick: [number, number] | null = null;
    for (const [x, y] of cands) {
      if (x < 12 || x + cw > vw - 12 || y < 12 || y + chH > vh - 12) continue;
      if (hits(x, y)) continue;
      pick = [x, y];
      break;
    }
    let over = !pick;
    if (!pick || hits(pick[0], pick[1])) {
      over = true;
      pick = [(vw - cw) / 2, vh - chH - 18];
    }
    apply({
      step: index,
      x: Math.round(r.left - 4),
      y: Math.round(r.top - 4),
      w: Math.round(r.width + 8),
      h: Math.round(r.height + 8),
      cx: Math.round(pick[0]),
      cy: Math.round(pick[1]),
      big: over,
    });
  }, [index, steps]);

  // Measure on step entry and re-measure while transitions/animations settle
  // (the .3–.45s choreography moves anchors after the switch), plus on resize.
  // If the anchor still isn't in the DOM once the choreography has settled
  // (a state-dependent target like the needs strip with nothing pending),
  // skip the step in the direction of travel instead of stranding the ring.
  useEffect(() => {
    if (index == null) return;
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 480);
    const step = steps[index];
    const t3 = setTimeout(() => {
      if (step && !document.querySelector(`[data-tour="${step.sel}"]`)) go(index + dirRef.current);
    }, 700);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", measure);
    };
  }, [index, measure, steps, go]);

  return { index, rect, go, stop, start: () => go(0) };
}

interface BoldTourLayerProps {
  steps: BoldTourStep[];
  index: number;
  rect: TourRect;
  onGo: (i: number) => void;
  onSkip: () => void;
}

/** Pulsing spotlight ring + STEP N OF 8 card (canon tour proto, verbatim anatomy). */
export function BoldTourLayer({ steps, index, rect, onGo, onSkip }: BoldTourLayerProps) {
  const step = steps[index];
  if (!step) return null;
  return (
    <div className="cvb-tour-layer">
      <div className="cvb-tour-ring" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
      <div data-tour-card="1" className="cvb-tour-card" data-testid="bold-tour-card" style={{ left: rect.cx, top: rect.cy }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-forest)", fontWeight: 600 }}>
            STEP {index + 1} OF {steps.length}
          </span>
          <span style={{ flex: 1 }} />
          <span data-testid="bold-tour-skip" style={{ fontSize: 11, color: "var(--cvb-faint-2)", cursor: "pointer", flex: "none" }} onClick={onSkip}>
            Skip tour ✕
          </span>
        </div>
        <div className="cvb-display" style={{ fontWeight: 900, fontSize: 16.5, letterSpacing: "-.02em", lineHeight: 1.25, marginTop: 7 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 5, textWrap: "pretty" }}>{step.body}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 12 }}>
          {steps.map((s, n) => (
            <span
              key={s.sel + s.title}
              onClick={() => onGo(n)}
              style={{ width: 7, height: 7, borderRadius: "50%", background: n === index ? "var(--cvb-forest)" : "var(--cvb-line-ctl)", cursor: "pointer", flex: "none" }}
            />
          ))}
          <span style={{ flex: 1 }} />
          {index > 0 ? (
            <button type="button" className="cvb-tour-back" data-testid="bold-tour-back" onClick={() => onGo(index - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="cvb-tour-next" data-testid="bold-tour-next" onClick={() => onGo(index + 1)}>
            {index === steps.length - 1 ? "Done ✓" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The ? launcher pinned bottom-right (canon proto — replaces the retired
 *  "FIRST TIME HERE" invite card; gradient never fills buttons). */
export function BoldHelpLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="cvb-help-launcher" title="Help & tour" data-testid="bold-tour-btn" onClick={onClick}>
      ?
    </button>
  );
}

interface BoldGettingStartedDrawerProps {
  checklist: GettingStartedResponse | "loading" | "error";
  onClose: () => void;
  onStartTour: () => void;
}

/** Getting-started drawer over the ? launcher — every done-state
 *  server-derived (GET /me/getting-started), never hard-coded. */
export function BoldGettingStartedDrawer({ checklist, onClose, onStartTour }: BoldGettingStartedDrawerProps) {
  const loaded = typeof checklist === "object" ? checklist : null;
  return (
    <div className="cvb-help-drawer" data-testid="bold-help-drawer">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-faint-2)" }}>
          {loaded ? `GETTING STARTED · ${loaded.done} OF ${loaded.total}` : "GETTING STARTED"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--cvb-faint-2)", cursor: "pointer" }} onClick={onClose}>
          ✕
        </span>
      </div>
      {checklist === "loading" ? (
        <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 12 }}>Checking your setup…</div>
      ) : checklist === "error" ? (
        <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 12 }} data-testid="bold-help-drawer-error">
          Couldn't load the checklist — the API isn't reachable right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 9 }}>
          {checklist.items.map((c) => (
            <div key={c.key} data-testid={`bold-gs-${c.key}`} data-done={c.done ? "true" : "false"} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid var(--cvb-line-inner)" }}>
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  background: c.done ? "var(--cvb-mint)" : "var(--cvb-wash)",
                  border: c.done ? "1px solid var(--cvb-mint-line)" : "1px solid var(--cvb-line-ctl)",
                  color: "var(--cvb-forest)",
                }}
              >
                {c.done ? "✓" : ""}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: c.done ? "var(--cvb-faint-2)" : "var(--cvb-ink)", textDecoration: c.done ? "line-through" : "none" }}>
                {c.label}
              </span>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="cvb-help-drawer-cta" data-testid="bold-tour-replay" onClick={onStartTour}>
        Start the product tour
      </button>
    </div>
  );
}
