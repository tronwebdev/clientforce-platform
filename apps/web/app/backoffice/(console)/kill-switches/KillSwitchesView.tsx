"use client";

import { useCallback, useState } from "react";
import { KILL_SWITCH_CHANNELS, type BackofficeAgencyRow, type KillSwitchRow } from "@clientforce/core";
import { Button, Modal, Pill, Toast } from "@clientforce/ui";

// Only the channels whose send boundary enforces the switch (email + SMS today).
// voice/whatsapp re-enter when they wire assertChannelLive — Q-025 / the ride-along.
const CHANNELS = KILL_SWITCH_CHANNELS;
type Channel = (typeof CHANNELS)[number];

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const keyOf = (agencyId: string, channel: string) => `${agencyId}::${channel}`;

/**
 * The kill-switch console. For every agency we render the four channels with
 * their live state (from the switch list); an active switch is the "killed"
 * state. Toggling opens a reason modal (audited) → POST /kill-switches.
 */
export function KillSwitchesView({
  agencies,
  initialSwitches,
}: {
  agencies: BackofficeAgencyRow[];
  initialSwitches: KillSwitchRow[];
}) {
  const [byKey, setByKey] = useState<Map<string, KillSwitchRow>>(
    () => new Map(initialSwitches.map((s) => [keyOf(s.agencyId, s.channel), s])),
  );
  const [modal, setModal] = useState<{ agencyId: string; agencyName: string; channel: Channel; kill: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = (await bo("kill-switches").catch(() => null)) as KillSwitchRow[] | null;
    if (rows) setByKey(new Map(rows.map((s) => [keyOf(s.agencyId, s.channel), s])));
  }, []);

  const isKilled = (agencyId: string, channel: string): boolean =>
    byKey.get(keyOf(agencyId, channel))?.active === true;

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Kill switches
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 20px", maxWidth: 720 }}>
        Per-agency, per-channel emergency stop. A killed channel refuses every send for that agency at the
        boundary (typed <code style={{ fontFamily: "monospace" }}>CHANNEL_KILLED</code>) until you clear it.
        Every change is audited.
      </p>

      {agencies.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No agencies.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {agencies.map((a) => (
            <section key={a.id} style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: "#8a938d" }}>{a.slug}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {CHANNELS.map((channel) => {
                  const killed = isKilled(a.id, channel);
                  const row = byKey.get(keyOf(a.id, channel));
                  return (
                    <div
                      key={channel}
                      style={{
                        border: "1px solid var(--cf-color-hairline, #ebe3d6)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: killed ? "rgba(201,84,63,0.06)" : "transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{channel}</div>
                        <div style={{ marginTop: 3 }}>
                          <Pill tone={killed ? "warn" : "success"}>{killed ? "Killed" : "Live"}</Pill>
                        </div>
                        {killed && row?.reason ? (
                          <div style={{ fontSize: 11, color: "#8a938d", marginTop: 4 }} title={row.reason}>
                            {row.reason.length > 40 ? `${row.reason.slice(0, 40)}…` : row.reason}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setModal({ agencyId: a.id, agencyName: a.name, channel, kill: !killed })}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 8,
                          border: `1px solid ${killed ? "var(--cf-color-hairline, #ebe3d6)" : "rgba(201,84,63,0.4)"}`,
                          background: killed ? "#fff" : "rgba(201,84,63,0.08)",
                          color: killed ? "#0e1512" : "var(--cf-color-danger, #c9543f)",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {killed ? "Restore" : "Kill"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {modal ? (
        <KillDialog
          modal={modal}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            setToast(message);
            void refresh();
          }}
        />
      ) : null}
      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </div>
  );
}

function KillDialog({
  modal,
  onClose,
  onDone,
}: {
  modal: { agencyId: string; agencyName: string; channel: Channel; kill: boolean };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required (audited).");
      return;
    }
    setBusy(true);
    try {
      await bo("kill-switches", {
        method: "POST",
        body: JSON.stringify({ agencyId: modal.agencyId, channel: modal.channel, active: modal.kill, reason }),
      });
      onDone(
        modal.kill
          ? `${modal.channel} killed for ${modal.agencyName}.`
          : `${modal.channel} restored for ${modal.agencyName}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${modal.kill ? "Kill" : "Restore"} ${modal.channel} · ${modal.agencyName}`}
      subtitle={
        modal.kill
          ? "Every send on this channel for this agency will be refused at the boundary until restored."
          : "Sending on this channel is restored immediately."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} type="button" disabled={busy}>
            {busy ? "Working…" : modal.kill ? "Kill channel" : "Restore channel"}
          </Button>
        </>
      }
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        Reason (audited)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={modal.kill ? "Why is this channel being killed?" : "Why is it safe to restore?"}
          style={{ borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "10px 12px", fontSize: 14, resize: "vertical" }}
        />
      </label>
      {error ? <p style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13, margin: "10px 0 0" }}>{error}</p> : null}
    </Modal>
  );
}
