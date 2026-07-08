"use client";

/**
 * A3 first-run (DEC-060): minimal "Create workspace" modal for a signed-in
 * principal with zero memberships — system anatomy (card, Bricolage heading,
 * gradient primary), deliberately NOT the Onboarding.dc.html flow (out of
 * scope; Q-item in DEC-060). POSTs the first-run /workspaces endpoint, then
 * reloads into the freshly scoped shell.
 */
import { useState } from "react";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

export function FirstRunWorkspace() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length >= 2;

  async function create() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cf/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError("Couldn't create the workspace — try again.");
      return;
    }
    window.location.href = "/agents";
  }

  return (
    <main style={{ minHeight: "100vh", background: "#FBF7F0", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 460, maxWidth: "100%", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, boxShadow: "0 20px 60px rgba(14,21,18,.08)", padding: "34px 32px" }} data-testid="first-run-modal">
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 24, color: "#0E1512", marginBottom: 6 }}>
          Create your workspace
        </div>
        <div style={{ fontSize: 13.5, color: "#8A7F6B", lineHeight: 1.5, marginBottom: 22 }}>
          You&apos;re signed in — one workspace holds your agents, contacts and campaigns.
        </div>
        <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
          Workspace name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="e.g. BrightPath Dental"
          autoFocus
          style={{ width: "100%", boxSizing: "border-box", height: 46, borderRadius: 12, border: `1px solid ${error ? "#E0796B" : "#EBE3D6"}`, padding: "0 14px", fontSize: 14.5, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif", outline: "none" }}
          data-testid="first-run-name"
        />
        {error ? (
          <div style={{ fontSize: 12.5, color: "#C9543F", fontWeight: 600, marginTop: 8 }} data-testid="first-run-error">{error}</div>
        ) : null}
        <button
          onClick={() => void create()}
          disabled={!valid || busy}
          style={{ width: "100%", marginTop: 18, height: 48, borderRadius: 12, border: "none", background: valid && !busy ? GRAD : "#ECE7DC", color: valid && !busy ? "#0A0F0C" : "#9AA59E", fontWeight: 700, fontSize: 15, fontFamily: "'Hanken Grotesk',sans-serif", cursor: valid && !busy ? "pointer" : "not-allowed", boxShadow: valid && !busy ? "0 6px 16px rgba(53,232,52,.26)" : "none" }}
          data-testid="first-run-create"
        >
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </div>
    </main>
  );
}
