"use client";

/**
 * B3d (DEC-122): the approvals panel — the campaign Overview strip's
 * destination. The prototype gives the strip (amber count + line +
 * "Review →") but no queue surface behind it, so this panel is a designed
 * addition, flagged: item anatomy borrowed from the prototype's NEEDS YOU
 * card (amber card, count square, title, provenance line, action button).
 * Row-backed items decide here; a reply item opens the inbox — its decision
 * IS the composer.
 */
import { useCallback, useEffect, useState } from "react";
import { decideApproval, fetchApprovals, relTime, type ApprovalQueueItem } from "./bold-live";

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const KIND_WORD: Record<string, string> = {
  step_send: "Scheduled send",
  step_call: "Scheduled call",
  budget_move: "Budget change",
  branch_start: "New branch",
  campaign_proposal: "Campaign idea",
  reply_draft: "Reply waiting",
};

export function BoldApprovalsPanel({
  agentId,
  onClose,
  onOpenInbox,
  flash,
}: {
  agentId: string;
  onClose: () => void;
  onOpenInbox?: () => void;
  flash?: (msg: string) => void;
}) {
  const [items, setItems] = useState<ApprovalQueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchApprovals(agentId);
    setItems(res?.items ?? []);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: ApprovalQueueItem, decision: "approved" | "dismissed") {
    if (!item.approvalId || busy) return;
    setBusy(item.approvalId);
    try {
      const res = await decideApproval(item.approvalId, decision);
      if (!res.ok) {
        flash?.(res.error || "That decision did not save — try again.");
        return;
      }
      flash?.(decision === "approved" ? "Approved — it goes out on the next check." : "Dismissed.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,.16)", zIndex: 60 }}
      />
      <div
        data-testid="bold-approvals"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 392,
          maxWidth: "88%",
          background: "var(--cvb-card)",
          borderLeft: "1px solid var(--cvb-line-ctl)",
          padding: "26px 24px",
          zIndex: 61,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>
              NEEDS YOU
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.02em", marginTop: 4 }}>
              Waiting on your tap
            </div>
          </div>
          <span
            onClick={onClose}
            data-testid="bold-approvals-close"
            style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", border: "1px solid var(--cvb-line-ctl)", cursor: "pointer", color: "var(--cvb-muted)" }}
          >
            ✕
          </span>
        </div>

        {items === null ? (
          <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>Reading the queue…</div>
        ) : items.length === 0 ? (
          <div data-testid="bold-approvals-empty" style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.5 }}>
            Nothing needs you right now — Ada keeps working inside her limits.
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.approvalId ?? `${item.kind}-${item.contactId}-${i}`}
              data-testid={`bold-approval-item-${item.kind}`}
              style={{ background: "var(--cvb-amber-bg, #FDFBF4)", border: "1px solid var(--cvb-amber-line, #EFE6CF)", borderRadius: 15, padding: 13, marginBottom: 10 }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  style={{ width: 30, height: 30, borderRadius: 9, flex: "none", display: "grid", placeItems: "center", background: "#F7EFDA", border: "1px solid #EAD9A8", color: "var(--cvb-amber, #8A6D1A)", fontSize: 13 }}
                >
                  {item.kind === "step_call" ? "☎" : item.kind === "reply_draft" ? "↩" : "✉"}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.4 }}>{item.reason}</div>
                  <div style={{ fontSize: 11, color: "var(--cvb-amber, #7A6220)", marginTop: 3 }}>
                    {KIND_WORD[item.kind] ?? item.kind} · {relTime(item.createdAt)}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                {item.approvalId ? (
                  <>
                    <span
                      onClick={() => void decide(item, "approved")}
                      data-testid="bold-approval-approve"
                      style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 10, padding: "7px 13px", cursor: "pointer", opacity: busy === item.approvalId ? 0.6 : 1 }}
                    >
                      Approve
                    </span>
                    <span
                      onClick={() => void decide(item, "dismissed")}
                      data-testid="bold-approval-dismiss"
                      style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-muted)", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 10, padding: "7px 13px", cursor: "pointer" }}
                    >
                      Dismiss
                    </span>
                  </>
                ) : item.kind === "reply_draft" ? (
                  <span
                    onClick={() => {
                      onClose();
                      onOpenInbox?.();
                    }}
                    data-testid="bold-approval-open-inbox"
                    style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 10, padding: "7px 13px", cursor: "pointer" }}
                  >
                    Answer in Inbox
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
