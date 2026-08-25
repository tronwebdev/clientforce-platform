"use client";

import { DOCK_DEFS, FIXTURE_ALWAYS_ON, dockTileTitle, type BoldSurface } from "./bold-data";

interface BoldDockProps {
  surface: BoldSurface;
  onSelect: (key: BoldSurface) => void;
}

/**
 * The 52px dock — 11 tiles in fixed order (ADDENDUM_4_BOLD §3), Receptionist
 * alone at top with a gap. Live dot `--cvb-live` pulsing; warn dot
 * `--cvb-warn-dot` solid; active tile mint fill + forest mark. Titles are
 * dynamic and must match state. Must fit 11 tiles at 540px viewport height.
 */
export function BoldDock({ surface, onSelect }: BoldDockProps) {
  return (
    <div data-tour="dock" className="cvb-dock" data-testid="bold-dock">
      {DOCK_DEFS.map((d) => {
        const active = surface === d.key;
        const isRcp = d.key === "rcp";
        const isWc = d.key === "chatbot";
        const live =
          (isRcp && FIXTURE_ALWAYS_ON.receptionist.owned) ||
          (isWc && FIXTURE_ALWAYS_ON.siteAgent.installed && FIXTURE_ALWAYS_ON.siteAgent.busy);
        const warn = isWc && !FIXTURE_ALWAYS_ON.siteAgent.installed;
        const stroke = active
          ? isRcp
            ? "var(--cvb-live)"
            : "var(--cvb-forest)"
          : isRcp
            ? "var(--cvb-forest)"
            : warn
              ? "var(--cvb-amber)"
              : "var(--cvb-icon-idle)";
        return (
          <button
            key={d.key}
            type="button"
            className="cvb-dock-tile"
            data-active={active ? "true" : "false"}
            data-warn={warn ? "true" : "false"}
            data-rcp={isRcp ? "true" : "false"}
            data-dock-key={d.key}
            data-testid={`bold-dock-${d.key}`}
            title={dockTileTitle(d)}
            aria-label={dockTileTitle(d)}
            onClick={() => onSelect(d.key)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={active ? 2.1 : 1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d={d.d} />
            </svg>
            {live ? <span className="cvb-dock-dot" data-kind="live" /> : null}
            {warn ? <span className="cvb-dock-dot" data-kind="warn" /> : null}
          </button>
        );
      })}
    </div>
  );
}
