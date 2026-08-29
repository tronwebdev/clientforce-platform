"use client";

/**
 * B4 (DEC-124): the Receptionist slide-over — the prototype's rcpPop, ported
 * in its ONE true state: not owned. There is no inbound-call engine yet
 * (Q-090 carries it: entitlement, an inbound number per DEC-123/Q-087, the
 * answering runtime, the setup wizard, the call log, and DEC-120 expansion
 * 3's end-of-call consent capture), so the pitch renders honestly with its
 * add-to-plan action visibly deferred — nothing pretends to answer a line.
 * The $39/mo + credits price is the prototype's proposal rendered as pitch
 * copy (Q-094: billing-sourced at B9). "Hear a call" waits on a real sample
 * (Q-095). At activation the plan button goes FOREST SOLID — DEC-126, the
 * gradient rule overrides the prototype fill on that control.
 */
import { useEffect } from "react";

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const WHAT_SHE_DOES: ReadonlyArray<readonly [string, string]> = [
  ["Answers from your facts", "Prices, hours, financing, recovery times — the same facts Ada writes with."],
  ["Books on the call", "Reads the calendar live and confirms while they are still talking."],
  ["Hands over cleanly", "Anything outside her lines transfers to you with the context, not from scratch."],
  ["Writes it all down", "Every call becomes a contact, a transcript and a next step."],
];

export function BoldReceptionistPanel({
  onClose,
  onPreview,
}: {
  onClose: () => void;
  /** B4.5 (owner ruling 5): "Preview a call" — the scripted, clearly-labeled
   *  demo through the live-call card. Supersedes the "Hear a call" slot. */
  onPreview?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,.16)", zIndex: 70 }} />
      <div
        data-testid="bold-rcp"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "92%", background: "var(--cvb-card)", borderLeft: "1px solid var(--cvb-line-ctl)", zIndex: 71, overflowY: "auto" }}
      >
        {/* Dark pitch hero — the prototype's unowned state. */}
        <div style={{ background: "linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)", padding: "22px 24px 24px", position: "relative" }}>
          <div style={{ height: 2, background: "var(--cvb-gradient-signature, linear-gradient(90deg,#36D7ED,#35E834 55%,#D0F56B))", position: "absolute", top: 0, left: 0, right: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(53,232,52,.14)", color: "#35E834", fontSize: 15, flex: "none" }}>
              ☎
            </span>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "rgba(255,255,255,.55)", flex: 1 }}>
              ADD-ON · $39/MO
            </span>
            <span
              onClick={onClose}
              data-testid="bold-rcp-close"
              style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", border: "1px solid rgba(255,255,255,.18)", color: "rgba(255,255,255,.7)", cursor: "pointer" }}
            >
              ✕
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.026em", color: "#F2F6F2", lineHeight: 1.15, marginTop: 14 }}>
            Your line,
            <br />
            answered.
          </div>
          <div style={{ fontSize: 12.5, color: "rgba(242,246,242,.72)", lineHeight: 1.55, marginTop: 10 }}>
            Every call picked up the moment you can&rsquo;t — grounded in your business facts,
            booked into your calendar.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16 }}>
            <span
              data-testid="bold-rcp-deferred"
              title="Coming soon"
              style={{ fontSize: 12, fontWeight: 800, color: "rgba(242,246,242,.55)", background: "rgba(242,246,242,.1)", border: "1px dashed rgba(242,246,242,.28)", borderRadius: 10, padding: "8px 13px", cursor: "default" }}
            >
              Add to plan · $39/mo — coming soon
            </span>
            {onPreview ? (
              <span
                onClick={onPreview}
                data-testid="bold-rcp-preview"
                style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "8px 13px", cursor: "pointer" }}
              >
                Preview a call
              </span>
            ) : null}
          </div>
          <div style={{ ...mono, fontSize: 9.5, color: "rgba(242,246,242,.5)", lineHeight: 1.6, marginTop: 12 }}>
            ✦ Discloses it&rsquo;s an AI assistant on every call. $39/mo plus 15 credits a
            minute of talk time.
          </div>
        </div>

        {/* Stats strip — the honest "once she is on" variants. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "14px 18px" }}>
          {(
            [
              ["CALLS TAKEN", "—", "once she is on"],
              ["BOOKED ON THE CALL", "—", "typical: 1 in 4"],
              ["AFTER HOURS", "—", "evenings and Sundays"],
            ] as const
          ).map(([label, value, sub]) => (
            <div key={label} style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 12, padding: "10px 11px" }}>
              <div style={{ ...mono, fontSize: 8, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>{label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3 }}>{value}</div>
              <div style={{ ...mono, fontSize: 8.5, color: "var(--cvb-ghost)", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* WHAT SHE DOES ON A CALL — the pitch cards, verbatim posture. */}
        <div style={{ padding: "0 18px 20px" }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", margin: "6px 0 10px" }}>
            WHAT SHE DOES ON A CALL
          </div>
          {WHAT_SHE_DOES.map(([title, body]) => (
            <div key={title} style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: "11px 13px", marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 3 }}>{body}</div>
            </div>
          ))}
          <div data-testid="bold-rcp-note" style={{ ...mono, fontSize: 9.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 10 }}>
            Inbound answering is on its way — it needs a number of its own and the machinery to
            pick up. Outbound calling is already yours.
          </div>
        </div>
      </div>
    </>
  );
}
