"use client";

/**
 * Step 4 — Enable lead capture (W3 commit 0: pure move from Wizard.tsx).
 * Visual only in P1 (checkpoints §3): toggle state persists via draftState,
 * no capture backend. All state stays in the Wizard orchestrator.
 */
import { GRAD } from "../shared";

interface Step4Props {
  capture: { widget: boolean; form: boolean };
  setCapture: React.Dispatch<React.SetStateAction<{ widget: boolean; form: boolean }>>;
}

export function Step4Capture(props: Step4Props) {
  const { capture, setCapture } = props;
  return (
    <>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              {(
                [
                  { key: "widget", title: "Website chat widget", desc: "Qualify visitors and capture leads 24/7." },
                  { key: "form", title: "Form capture", desc: "Route form submissions into the sequence." },
                ] as const
              ).map((c) => (
                <div key={c.key} style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>{c.title}</div>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>{c.desc}</div>
                  </div>
                  <div onClick={() => setCapture((v) => ({ ...v, [c.key]: !v[c.key] }))} style={{ width: 48, height: 28, borderRadius: 100, background: capture[c.key] ? GRAD : "#E4DDCE", position: "relative", cursor: "pointer", flex: "none", transition: "background .15s" }} data-testid={`capture-${c.key}`}>
                    <span style={{ position: "absolute", top: 3, left: capture[c.key] ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .15s" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 14 }}>This step is optional — you can skip it and connect capture sources any time later.</div>
          </div>
    </>
  );
}
