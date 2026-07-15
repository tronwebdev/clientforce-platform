"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import type { BackofficeAgencyRow, BackofficeWorkspaceRow, TenantStatusName } from "@clientforce/core";
import { Button, DataTable, Modal, Pill, Toast, type PillTone } from "@clientforce/ui";

type ModalState =
  | { kind: "agency-status"; id: string; name: string; next: "SUSPENDED" | "ACTIVE" }
  | { kind: "workspace-status"; id: string; name: string; next: "SUSPENDED" | "ACTIVE" }
  | { kind: "credit"; id: string; name: string; balance: number }
  | null;

const statusTone = (s: TenantStatusName): PillTone =>
  s === "ACTIVE" ? "success" : s === "SUSPENDED" ? "warn" : "neutral";

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString() : "—");

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function TenantsView({
  initial,
  initialQuery,
}: {
  initial: BackofficeAgencyRow[];
  initialQuery: string;
}) {
  const [agencies, setAgencies] = useState<BackofficeAgencyRow[]>(initial);
  const [query, setQuery] = useState(initialQuery);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async (q: string) => {
    const rows = (await bo(`agencies${q ? `?q=${encodeURIComponent(q)}` : ""}`).catch(
      () => null,
    )) as BackofficeAgencyRow[] | null;
    if (rows) setAgencies(rows);
  }, []);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    void refresh(query);
  };

  const workspaceColumns = (agencyName: string) => [
    {
      key: "name",
      header: "Workspace",
      cell: (w: BackofficeWorkspaceRow) => (
        <div>
          <div style={{ fontWeight: 600 }}>{w.name}</div>
          <div style={{ fontSize: 11, color: "#8a938d" }}>{w.slug}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (w: BackofficeWorkspaceRow) => <Pill tone={statusTone(w.status)}>{w.status}</Pill>,
    },
    {
      key: "credits",
      header: "Credits",
      cell: (w: BackofficeWorkspaceRow) => <span>{w.creditBalance.toLocaleString()}</span>,
    },
    {
      key: "created",
      header: "Created",
      cell: (w: BackofficeWorkspaceRow) => <span style={{ color: "#5b6560" }}>{fmtDate(w.createdAt)}</span>,
    },
    {
      key: "activity",
      header: "Last activity",
      cell: (w: BackofficeWorkspaceRow) => (
        <span style={{ color: "#5b6560" }}>{fmtDate(w.lastActivityAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (w: BackofficeWorkspaceRow) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <SmallButton
            onClick={() =>
              setModal({
                kind: "workspace-status",
                id: w.id,
                name: `${agencyName} / ${w.name}`,
                next: w.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
              })
            }
          >
            {w.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
          </SmallButton>
          <SmallButton
            onClick={() =>
              setModal({ kind: "credit", id: w.id, name: `${agencyName} / ${w.name}`, balance: w.creditBalance })
            }
          >
            Credits
          </SmallButton>
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Tenants
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 18px" }}>
        Every agency and workspace on the platform. Suspend/reactivate is typed and reversible; credit
        grants are append-only ledger entries. All actions are audited.
      </p>

      <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agencies or workspaces…"
          aria-label="Search tenants"
          style={{
            flex: 1,
            maxWidth: 420,
            height: 40,
            borderRadius: 10,
            border: "1px solid var(--cf-color-hairline, #ebe3d6)",
            padding: "0 12px",
            fontSize: 14,
          }}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {agencies.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No agencies match “{query}”.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {agencies.map((a) => (
            <section key={a.id} style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 16, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 18, fontWeight: 700 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: "#8a938d" }}>
                    {a.slug} · created {fmtDate(a.createdAt)} · last activity {fmtDate(a.lastActivityAt)}
                  </div>
                </div>
                <Pill tone="neutral">{a.planTier}</Pill>
                <Pill tone={statusTone(a.status)}>{a.status}</Pill>
                <SmallButton
                  onClick={() =>
                    setModal({
                      kind: "agency-status",
                      id: a.id,
                      name: a.name,
                      next: a.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
                    })
                  }
                >
                  {a.status === "SUSPENDED" ? "Reactivate agency" : "Suspend agency"}
                </SmallButton>
              </div>

              <DataTable<BackofficeWorkspaceRow>
                columns={workspaceColumns(a.name)}
                rows={a.workspaces}
                rowKey={(w) => w.id}
                gridTemplate="minmax(0,1.6fr) 120px 100px 110px 150px 220px"
                empty={<div style={{ padding: 20, color: "#8a938d" }}>No workspaces.</div>}
              />
            </section>
          ))}
        </div>
      )}

      {modal ? (
        <ActionDialog
          modal={modal}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            setToast(message);
            void refresh(query);
          }}
        />
      ) : null}

      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </div>
  );
}

function SmallButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid var(--cf-color-hairline, #ebe3d6)",
        background: "#fff",
        fontSize: 13,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ActionDialog({
  modal,
  onClose,
  onDone,
}: {
  modal: NonNullable<ModalState>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStatus = modal.kind === "agency-status" || modal.kind === "workspace-status";
  const title =
    modal.kind === "credit"
      ? "Adjust credits"
      : modal.next === "SUSPENDED"
        ? "Suspend"
        : "Reactivate";

  const submit = async () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required.");
      return;
    }
    setBusy(true);
    try {
      if (modal.kind === "agency-status") {
        const verb = modal.next === "SUSPENDED" ? "suspend" : "reactivate";
        await bo(`agencies/${modal.id}/${verb}`, { method: "POST", body: JSON.stringify({ reason }) });
        onDone(`Agency ${modal.next === "SUSPENDED" ? "suspended" : "reactivated"}.`);
      } else if (modal.kind === "workspace-status") {
        const verb = modal.next === "SUSPENDED" ? "suspend" : "reactivate";
        await bo(`workspaces/${modal.id}/${verb}`, { method: "POST", body: JSON.stringify({ reason }) });
        onDone(`Workspace ${modal.next === "SUSPENDED" ? "suspended" : "reactivated"}.`);
      } else {
        const n = Number(delta);
        if (!Number.isInteger(n) || n === 0) {
          setError("Enter a non-zero whole number of credits (use a minus sign to claw back).");
          setBusy(false);
          return;
        }
        const result = (await bo(`workspaces/${modal.id}/credit-adjustments`, {
          method: "POST",
          body: JSON.stringify({ delta: n, reason }),
        })) as { balanceAfter: number };
        onDone(`Credits adjusted — new balance ${result.balanceAfter.toLocaleString()}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${title} · ${modal.name}`}
      subtitle={
        isStatus
          ? modal.next === "SUSPENDED"
            ? "Suspending refuses all sends for this tenant until reactivated."
            : "Reactivating restores sending."
          : `Current balance: ${modal.kind === "credit" ? modal.balance.toLocaleString() : ""} credits`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} type="button" disabled={busy}>
            {busy ? "Working…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {modal.kind === "credit" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            Credit delta (negative to claw back)
            <input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 5000 or -1000"
              style={{ height: 40, borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "0 12px", fontSize: 14 }}
            />
          </label>
        ) : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          Reason (audited)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why are you making this change?"
            style={{ borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "10px 12px", fontSize: 14, resize: "vertical" }}
          />
        </label>
        {error ? <p style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13, margin: 0 }}>{error}</p> : null}
      </div>
    </Modal>
  );
}
