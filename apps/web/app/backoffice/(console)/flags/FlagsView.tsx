"use client";

import { useCallback, useState } from "react";
import type { BackofficeAgencyRow, FeatureFlagRow } from "@clientforce/core";
import { Button, Pill, Toast } from "@clientforce/ui";

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/**
 * Feature-flag editor. Pick a workspace from the tenant tree, load its flags,
 * and toggle them (or add a new key). Each write is a POST to
 * `workspaces/:id/flags` — upsert, audited.
 */
export function FlagsView({ agencies }: { agencies: BackofficeAgencyRow[] }) {
  const workspaces = agencies.flatMap((a) => a.workspaces.map((w) => ({ ...w, agencyName: a.name })));
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [flags, setFlags] = useState<FeatureFlagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setFlags([]);
      return;
    }
    setLoading(true);
    const rows = (await bo(`workspaces/${id}/flags`).catch(() => null)) as FeatureFlagRow[] | null;
    setFlags(rows ?? []);
    setLoading(false);
  }, []);

  const onPick = (id: string) => {
    setWorkspaceId(id);
    setError(null);
    void load(id);
  };

  const setFlag = async (key: string, enabled: boolean) => {
    setError(null);
    setBusyKey(key);
    try {
      await bo(`workspaces/${workspaceId}/flags`, { method: "POST", body: JSON.stringify({ key, enabled }) });
      await load(workspaceId);
      setToast(`Flag “${key}” ${enabled ? "enabled" : "disabled"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusyKey(null);
    }
  };

  const addFlag = async () => {
    const key = newKey.trim();
    if (!key) {
      setError("Enter a flag key.");
      return;
    }
    await setFlag(key, true);
    setNewKey("");
  };

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Feature flags
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 20px", maxWidth: 720 }}>
        Per-workspace toggles, set by operators and audited. The flag store is written only from here; the app
        reads flags to gate features.
      </p>

      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, maxWidth: 460, marginBottom: 20 }}>
        Workspace
        <select
          value={workspaceId}
          onChange={(e) => onPick(e.target.value)}
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

      {!workspaceId ? null : loading ? (
        <div style={{ color: "#8a938d", fontSize: 13 }}>Loading flags…</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, overflow: "hidden", maxWidth: 620 }}>
          {flags.length === 0 ? (
            <div style={{ padding: "18px 20px", color: "#8a938d", fontSize: 13 }}>
              No flags set for this workspace yet — add one below.
            </div>
          ) : (
            flags.map((f) => (
              <div
                key={f.key}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--cf-color-hairline, #ebe3d6)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "monospace", fontSize: 13 }}>{f.key}</div>
                  <div style={{ fontSize: 11, color: "#8a938d", marginTop: 2 }}>
                    updated {new Date(f.updatedAt).toLocaleString()}
                  </div>
                </div>
                <Pill tone={f.enabled ? "success" : "neutral"}>{f.enabled ? "On" : "Off"}</Pill>
                <button
                  type="button"
                  disabled={busyKey === f.key}
                  onClick={() => void setFlag(f.key, !f.enabled)}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: "1px solid var(--cf-color-hairline, #ebe3d6)",
                    background: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: busyKey === f.key ? "default" : "pointer",
                    opacity: busyKey === f.key ? 0.6 : 1,
                  }}
                >
                  {f.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            ))
          )}

          <div style={{ display: "flex", gap: 8, padding: "14px 20px", alignItems: "center" }}>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="new_flag_key"
              aria-label="New flag key"
              style={{ flex: 1, height: 38, borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "0 12px", fontFamily: "monospace", fontSize: 13 }}
            />
            <Button variant="secondary" type="button" onClick={() => void addFlag()} disabled={busyKey !== null}>
              Add &amp; enable
            </Button>
          </div>
        </div>
      )}

      {error ? <p style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13, marginTop: 12 }}>{error}</p> : null}
      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </div>
  );
}
