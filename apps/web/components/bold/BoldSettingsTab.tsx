"use client";

/**
 * B3d (DEC-122): the campaign Settings tab goes live with its first block —
 * HOW MUCH ADA DECIDES, the prototype's three-level radio (radio cards, mint
 * selected state, mono footnote), reading/writing the campaign's autonomy
 * level through the shipped guardrails PATCH (the server preserves every
 * rider a client omits; this client sends the level explicitly).
 *
 * The prototype's remaining Settings sections (channel toggles, guardrail
 * rows, cap stepper, voice cards) are visibly deferred below — never dropped
 * silently; today those controls live in the classic console's settings.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentListItem, Guardrails } from "@clientforce/core";
import { fetchBoldView, patchAgentGuardrails } from "./bold-live";

type Level = "ask" | "limits" | "full";

const LEVELS: ReadonlyArray<readonly [Level, string, string, string]> = [
  ["ask", "Ask me first", "Nothing sends without your tap. Slowest, safest.", "every send queued"],
  [
    "limits",
    "Act inside limits",
    "She sends, books and replies within the guardrails below. Anything outside them waits for you.",
    "the default",
  ],
  [
    "full",
    "Full autonomy",
    "She also moves budget and starts branches. You get receipts, not questions.",
    "for campaigns you trust",
  ],
];

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

export function BoldSettingsTab({
  agent,
  flash,
}: {
  agent: AgentListItem;
  flash?: (msg: string) => void;
}) {
  const [guardrails, setGuardrails] = useState<Guardrails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const view = await fetchBoldView(agent.id);
    setGuardrails(view?.guardrails ?? null);
    setLoaded(true);
  }, [agent.id]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  const level: Level = (guardrails?.autonomy as Level | undefined) ?? "limits";

  async function pick(next: Level, title: string) {
    if (saving || !guardrails || next === level) return;
    setSaving(true);
    try {
      const res = await patchAgentGuardrails(agent.id, { ...guardrails, autonomy: next });
      if (!res.ok) {
        flash?.(res.error || "The setting did not save — try again.");
        return;
      }
      setGuardrails({ ...guardrails, autonomy: next });
      flash?.(title);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="bold-settings" style={{ padding: "26px 40px 40px" }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 16 }}>
        HOW MUCH ADA DECIDES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 11 }}>
        {LEVELS.map(([key, title, body, note]) => {
          const on = loaded && level === key;
          return (
            <div
              key={key}
              onClick={() => void pick(key, title)}
              data-testid={`bold-auto-${key}`}
              aria-checked={on}
              role="radio"
              style={{
                background: on ? "var(--cvb-mint)" : "var(--cvb-card)",
                border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                borderRadius: 18,
                padding: 18,
                cursor: "pointer",
                opacity: loaded ? (saving ? 0.7 : 1) : 0.55,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `2px solid ${on ? "var(--cvb-forest)" : "var(--cvb-ghost)"}`,
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: on ? "var(--cvb-forest)" : "transparent",
                    }}
                  />
                </span>
                <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.022em", color: on ? "var(--cvb-forest-ink, #0E3D22)" : "var(--cvb-ink)" }}>
                  {title}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: on ? "var(--cvb-forest)" : "var(--cvb-muted)", lineHeight: 1.55, marginTop: 10 }}>
                {body}
              </div>
              <div style={{ ...mono, fontSize: 9, color: on ? "var(--cvb-forest)" : "var(--cvb-faint)", marginTop: 12 }}>
                {note}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 14, lineHeight: 1.6 }}>
        Whatever the level, nothing skips the safety rails — quiet hours, consent, do-not-contact
        and the pause-when-a-human-replies rule always hold.
      </div>

      <div
        data-testid="bold-settings-deferred"
        style={{ marginTop: 26, background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 14, padding: "13px 15px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.5 }}
      >
        Channel toggles, sending caps and voice settings are on their way here — today those
        controls live in the classic console&rsquo;s campaign settings.
      </div>
    </div>
  );
}
