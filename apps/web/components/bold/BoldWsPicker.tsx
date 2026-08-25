"use client";

import { useState } from "react";
import type { Me } from "../../lib/types";
import { WS_MARKS } from "./bold-data";

interface BoldWsPickerProps {
  me: Me;
  onClose: () => void;
  /** Fired for the not-in-B0 actions (add workspace / account home → B10). */
  onNoop: (label: string) => void;
}

/**
 * The workspace switcher modal (prototype `wsPick`). Switching is REAL — it
 * posts the shipped `/api/workspace` cookie switch and reloads /bold, which
 * re-evaluates auth and the consoleBold flag against the new workspace.
 */
export function BoldWsPicker({ me, onClose, onNoop }: BoldWsPickerProps) {
  const [switching, setSwitching] = useState<string | null>(null);

  const pick = async (workspaceId: string, here: boolean) => {
    if (here) {
      onClose();
      return;
    }
    setSwitching(workspaceId);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) {
        window.location.assign("/bold");
        return;
      }
    } catch {
      // fall through to reset below
    }
    setSwitching(null);
  };

  return (
    <div className="cvb-ws-scrim" onClick={onClose}>
      <div className="cvb-ws-modal" data-testid="bold-ws-picker" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--cvb-font-mono)", fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>
              SWITCH WORKSPACE
            </div>
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.03em", marginTop: 6 }}>
              Which business?
            </div>
          </div>
          <span className="cvb-ada-close" role="button" aria-label="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          {me.memberships.map((m, i) => {
            const here = m.workspaceId === me.activeWorkspace?.id;
            return (
              <div
                key={m.workspaceId}
                className="cvb-ws-option"
                data-here={here ? "true" : "false"}
                data-testid={`bold-ws-option-${m.workspace.slug}`}
                onClick={() => void pick(m.workspaceId, here)}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    flex: "none",
                    background: WS_MARKS[i % WS_MARKS.length],
                    color: "var(--cvb-card)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: 14,
                  }}
                >
                  {m.workspace.name.charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.02em" }}>{m.workspace.name}</div>
                  <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 2 }}>
                    {switching === m.workspaceId ? "Switching…" : `${m.workspace.slug} · ${m.role}`}
                  </div>
                </div>
                {here ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--cvb-forest)",
                      background: "var(--cvb-mint)",
                      border: "1px solid var(--cvb-mint-line)",
                      borderRadius: 999,
                      padding: "3px 9px",
                      flex: "none",
                    }}
                  >
                    You are here
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "18px 0" }} />
        <div style={{ display: "flex", gap: 9 }}>
          <button type="button" className="cvb-ws-primary" onClick={() => onNoop("Add a workspace")}>
            Add a workspace
          </button>
          <button type="button" className="cvb-ws-secondary" onClick={() => onNoop("Account home")}>
            Account home
          </button>
        </div>
      </div>
    </div>
  );
}
