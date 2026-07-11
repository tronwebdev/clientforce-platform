"use client";

/**
 * Step 6 — Preview & launch (W3 commit 0: pure move from Wizard.tsx).
 * All state stays in the Wizard orchestrator.
 */
import type { CampaignGraph } from "@clientforce/core";
import { mainSteps, strategyStepsOf } from "../../../../lib/graph-path";
import { GOALS, type AddedContact } from "../shared";

interface Step6Props {
  goal: string | null;
  graph: CampaignGraph | null;
  added: AddedContact[];
  pickedList: { id: string; name: string; memberCount: number } | null;
  capture: { widget: boolean; form: boolean };
  allResolved: boolean;
  gapTotal: number;
  gapResolved: number;
}

export function Step6Review(props: Step6Props) {
  const { goal, graph, added, pickedList, capture, allResolved, gapTotal, gapResolved } = props;
  return (
    <>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
              {[
                { label: "Goal", value: GOALS.find((g) => g.key === goal)?.title ?? "—" },
                { label: "Sequence", value: graph ? `${mainSteps(graph).length} steps · ${strategyStepsOf(graph).length ? `${strategyStepsOf(graph).length} reply strategies` : "reply branch"}` : "—" },
                { label: "Contacts", value: pickedList ? `${added.length + pickedList.memberCount} enrolled at launch (incl. “${pickedList.name}”)` : `${added.length} enrolled at launch` },
                { label: "Lead capture", value: capture.widget || capture.form ? "Enabled" : "Off (optional)" },
              ].map((c) => (
                <div key={c.label} style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "14px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{c.value}</div>
                </div>
              ))}
            </div>
            {!allResolved ? (
              <div style={{ border: "1px solid rgba(232,196,91,.48)", borderRadius: 12, background: "rgba(232,196,91,.06)", padding: "12px 16px", fontSize: 13, color: "#8A7F6B" }} data-testid="launch-gate">
                ✦ {gapTotal - gapResolved} unresolved gap{gapTotal - gapResolved > 1 ? "s" : ""} — resolve them in step 1 (type it or let AI decide) before launching.
              </div>
            ) : (
              <div style={{ border: "1px solid rgba(53,232,52,.32)", borderRadius: 12, background: "rgba(53,232,52,.05)", padding: "12px 16px", fontSize: 13, color: "#0F7A28" }}>
                ✓ Everything the agent needs is resolved — ready to launch.
              </div>
            )}
          </div>
    </>
  );
}
