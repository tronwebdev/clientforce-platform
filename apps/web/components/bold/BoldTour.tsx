"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoldTourStep } from "./bold-data";

/**
 * Anchored product tour scaffold (ADDENDUM_4_BOLD §4.11) — spotlight ring +
 * dodging card, ported from the prototype's tourGo/measureTour. The step
 * table is the full 14; the scaffold runs the steps whose `data-tour` anchor
 * is present, so B1+ light up hero/act/tabs simply by rendering the anchors.
 *
 * Geometry notes ported with the logic (each was a real defect during the
 * design build): scroll the anchor into its own scroll window before
 * measuring; clip the ring to what is actually visible; verify geometry, not
 * just text presence; a target filling most of the screen cannot be dodged —
 * seat the card bottom-centre over it.
 */

export interface TourRect {
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
  const retryRef = useRef(0);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= steps.length) {
        setIndex(null);
        setRect(null);
        onFinish("Tour finished — the ? in the header reopens it");
        return;
      }
      const pre = steps[i]?.pre;
      if (pre) onPre(pre);
      retryRef.current = 0;
      setIndex(i);
    },
    [steps, onPre, onFinish],
  );

  const stop = useCallback(() => {
    setIndex(null);
    setRect(null);
    onFinish("Tour closed — the ? in the header reopens it");
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
    const cw = 344;
    const chH = Math.max(214, cEl ? cEl.offsetHeight + 8 : 262);
    const pad = 18;
    const clampY = (y: number) => Math.max(12, Math.min(y, vh - chH - 12));
    const clampX = (x: number) => Math.max(12, Math.min(x, vw - cw - 12));
    const hits = (x: number, y: number) => !(x + cw < r.left - 6 || x > r.right + 6 || y + chH < r.top - 6 || y > r.bottom + 6);

    const apply = (next: TourRect) => {
      setRect((cur) =>
        cur &&
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
  useEffect(() => {
    if (index == null) return;
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 480);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", measure);
    };
  }, [index, measure]);

  return { index, rect, go, stop, start: () => go(0) };
}

interface BoldTourLayerProps {
  steps: BoldTourStep[];
  index: number;
  rect: TourRect;
  onGo: (i: number) => void;
  onSkip: () => void;
}

/** Spotlight ring + chaptered card (prototype `tourOn` layer, verbatim anatomy). */
export function BoldTourLayer({ steps, index, rect, onGo, onSkip }: BoldTourLayerProps) {
  const step = steps[index];
  if (!step) return null;
  const chapters: string[] = [];
  for (const s of steps) if (!chapters.includes(s.ch)) chapters.push(s.ch);
  return (
    <div className="cvb-tour-layer">
      <div className="cvb-tour-ring" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
      <div
        data-tour-card="1"
        className="cvb-tour-card"
        data-testid="bold-tour-card"
        style={{ left: rect.cx, top: rect.cy, boxShadow: rect.big ? "0 0 0 7px var(--cvb-glow-ring)" : "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9, letterSpacing: ".17em", color: "var(--cvb-forest)", flex: 1 }}>{step.ch}</span>
          <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9, letterSpacing: ".12em", color: "var(--cvb-faint-2)", flex: "none" }}>
            {index + 1} of {steps.length}
          </span>
        </div>
        <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.032em", lineHeight: 1.22, marginTop: 11 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.58, marginTop: 9, textWrap: "pretty" }}>{step.body}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 17 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            {chapters.map((c) => {
              const on = c === step.ch;
              return (
                <span
                  key={c}
                  title={c}
                  className="cvb-tour-chapter"
                  style={{ width: on ? 18 : 8, background: on ? "var(--cvb-forest)" : "var(--cvb-line-ctl)" }}
                />
              );
            })}
          </div>
          {index > 0 ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cvb-faint)", cursor: "pointer", flex: "none" }} onClick={() => onGo(index - 1)}>
              Back
            </span>
          ) : null}
          <button type="button" className="cvb-tour-next" data-testid="bold-tour-next" onClick={() => onGo(index + 1)}>
            {index === steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
        <span style={{ display: "block", fontSize: 11, color: "var(--cvb-faint-2)", cursor: "pointer", marginTop: 12 }} onClick={onSkip}>
          Skip the tour
        </span>
      </div>
    </div>
  );
}

interface BoldTourOfferProps {
  stepCount: number;
  onStart: () => void;
  onHide: () => void;
}

/** First-run offer card, fixed bottom-left (prototype `tourOffer`). */
export function BoldTourOffer({ stepCount, onStart, onHide }: BoldTourOfferProps) {
  return (
    <div className="cvb-tour-offer" data-testid="bold-tour-offer">
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span className="cvb-ada-mark">✦</span>
        <span style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9, letterSpacing: ".16em", color: "rgba(255,255,255,.5)", flex: 1 }}>
          FIRST TIME HERE
        </span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,.4)", cursor: "pointer", flex: "none" }} onClick={onHide}>
          ✕
        </span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.022em", color: "var(--cvb-card)", marginTop: 12, lineHeight: 1.35 }}>
        {stepCount} stops, about two minutes
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.6)", marginTop: 6, lineHeight: 1.5 }}>
        What each part is for, and where Ada acts on her own.
      </div>
      <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
        <button type="button" className="cvb-tour-offer-cta" onClick={onStart}>
          Show me
        </button>
        <button type="button" className="cvb-tour-offer-later" onClick={onHide}>
          Later
        </button>
      </div>
    </div>
  );
}
