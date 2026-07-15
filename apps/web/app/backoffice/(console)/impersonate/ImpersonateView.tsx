"use client";

import { useState } from "react";
import type {
  BackofficeAgencyRow,
  ImpersonationMessage,
  ImpersonationSession,
} from "@clientforce/core";
import { Button, Pill } from "@clientforce/ui";

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/**
 * The impersonation surface: a start form (workspace + audited reason) and, once
 * started, a read-only viewer with a persistent banner. Every fetch here is a
 * GET; nothing on this screen can mutate tenant content.
 */
export function ImpersonateView({ agencies }: { agencies: BackofficeAgencyRow[] }) {
  const workspaces = agencies.flatMap((a) => a.workspaces.map((w) => ({ ...w, agencyName: a.name })));
  const [workspaceId, setWorkspaceId] = useState("");
  const [reason, setReason] = useState("");
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [messages, setMessages] = useState<ImpersonationMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    if (!workspaceId) {
      setError("Select a workspace.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required (audited).");
      return;
    }
    setBusy(true);
    try {
      const s = (await bo("impersonate", {
        method: "POST",
        body: JSON.stringify({ workspaceId, reason }),
      })) as ImpersonationSession;
      const msgs = (await bo(`workspaces/${workspaceId}/messages`)) as ImpersonationMessage[];
      setSession(s);
      setMessages(msgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const end = () => {
    setSession(null);
    setMessages([]);
    setReason("");
  };

  if (session) {
    return (
      <div>
        <ImpersonationBanner session={session} onEnd={end} />
        <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 24, fontWeight: 700, margin: "0 0 2px" }}>
          {session.workspace.name}
        </h1>
        <p style={{ color: "#5b6560", fontSize: 13, margin: "0 0 18px" }}>
          {session.agency.name} · {session.workspace.slug} · <Pill tone="neutral">{session.workspace.status}</Pill>
        </p>

        <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>
          Messages <span style={{ fontWeight: 400, color: "#8a938d", fontSize: 13 }}>(read-only preview)</span>
        </h2>
        {messages.length === 0 ? (
          <div style={{ padding: 20, color: "#8a938d", fontSize: 13, background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
            No messages in this workspace.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Pill tone={m.direction === "OUTBOUND" ? "neutral" : "success"}>
                    {m.direction === "OUTBOUND" ? "Sent" : "Received"}
                  </Pill>
                  <span style={{ fontSize: 12, color: "#8a938d", textTransform: "uppercase" }}>{m.channel}</span>
                  <span style={{ fontSize: 12, color: "#8a938d", marginLeft: "auto" }}>
                    {new Date(m.sentAt).toLocaleString()}
                  </span>
                </div>
                {m.subject ? <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{m.subject}</div> : null}
                <div style={{ fontSize: 13, color: "#3a433e", whiteSpace: "pre-wrap" }}>{m.preview}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Impersonate
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 20px", maxWidth: 720 }}>
        View a workspace as support, read-only. Starting a session is audited (
        <code style={{ fontFamily: "monospace" }}>impersonate.start</code>) with your reason. You can see the
        tenant’s content but never change it.
      </p>

      <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, padding: 20, maxWidth: 520, display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          Workspace
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            style={{ height: 40, borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "0 12px", fontSize: 14, background: "#fff" }}
          >
            <option value="">Select a workspace…</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.agencyName} / {w.name} ({w.slug})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          Reason (audited)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. investigating support ticket #1234"
            style={{ borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "10px 12px", fontSize: 14, resize: "vertical" }}
          />
        </label>
        {error ? <p style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13, margin: 0 }}>{error}</p> : null}
        <div>
          <Button variant="primary" type="button" onClick={() => void start()} disabled={busy}>
            {busy ? "Starting…" : "Start read-only session"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImpersonationBanner({ session, onEnd }: { session: ImpersonationSession; onEnd: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--cf-color-danger, #c9543f)",
        color: "#fff",
        borderRadius: 12,
        padding: "10px 16px",
        marginBottom: 20,
      }}
    >
      <span style={{ fontSize: 18 }} aria-hidden>
        👁
      </span>
      <div style={{ flex: 1, fontSize: 13 }}>
        <strong>Read-only impersonation.</strong> Viewing {session.workspace.name} as support since{" "}
        {new Date(session.startedAt).toLocaleTimeString()}. This session is audited; you cannot change tenant
        content.
      </div>
      <button
        type="button"
        onClick={onEnd}
        style={{
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.5)",
          background: "transparent",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        End session
      </button>
    </div>
  );
}
