"use client";

/**
 * B5 (DEC-130): the Proposals surface — DRAFT documents on the real Proposal
 * table. The document renderer follows the prototype's block anatomy (cover /
 * text / price with the best row highlighted / signature); text blocks edit
 * inline through the real PATCH. Block add/move/remove is Q-103 — the ADD A
 * BLOCK palette renders visibly deferred. The DELIVERY half — send, tracked
 * opens, viewed/signed states, the deposit link — is Q-100's spine: the send action
 * is visibly deferred, Activity says why it is empty, and no status but
 * "draft" can exist. The prototype's Templates segment has no spine either
 * (it is a no-op even there) — not rendered.
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchProposal,
  fetchProposals,
  patchProposal,
  type BoldProposalBlock,
  type BoldProposalRow,
} from "./bold-live";
import { BoldCardGrid, BoldCoverCard, BoldMetaStrip, BoldSegRow, mono } from "./bold-cards";

const TABS = ["Document", "Activity", "Settings"] as const;

const bestAmount = (p: BoldProposalRow): string => {
  for (const b of p.blocks) {
    if (b.kind === "price") {
      const best = b.options.find((o) => o.best) ?? b.options[0];
      if (best) return best.amount;
    }
  }
  return "—";
};

export function BoldProposalsView({
  onBuild,
  onCounts,
  flash,
}: {
  onBuild: () => void;
  onCounts: (documents: number) => void;
  flash: (msg: string) => void;
}) {
  const [rows, setRows] = useState<BoldProposalRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Document");
  const [detail, setDetail] = useState<{ proposal: BoldProposalRow; contactName: string | null } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: "", body: "" });

  const load = useCallback(async () => {
    const res = await fetchProposals();
    if (res) {
      setRows(res.proposals);
      onCounts(res.proposals.length);
    }
  }, [onCounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setTab("Document");
    setEditing(null);
    const d = await fetchProposal(id);
    if (d) setDetail(d);
  }, []);

  if (!openId || !detail) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-proposals">
        <BoldSegRow segments={["Yours"]} active="Yours" onPick={() => {}} cta="Ask Ada to draft" onCta={onBuild} ctaTestId="bold-proposals-build" />
        {rows && rows.length === 0 ? (
          <div style={{ marginTop: 26, border: "1px dashed var(--cvb-line-ctl)", borderRadius: 18, padding: 26, textAlign: "center", color: "var(--cvb-faint)", fontSize: 12.5 }}>
            No documents yet — draft the first one and it lives here.
          </div>
        ) : (
          <BoldCardGrid>
            {(rows ?? []).map((p, i) => (
              <BoldCoverCard
                key={p.id}
                index={i}
                kind="DRAFT DOCUMENT"
                title={p.title}
                pillTone="draft"
                pillText="Draft"
                value={bestAmount(p)}
                who={p.contactName ?? "No contact attached yet"}
                onOpen={() => void open(p.id)}
                testId={`bold-proposal-card-${i}`}
              />
            ))}
          </BoldCardGrid>
        )}
      </div>
    );
  }

  const { proposal, contactName } = detail;
  const back = () => {
    setOpenId(null);
    setDetail(null);
    void load();
  };
  const saveBlock = async (idx: number) => {
    const blocks = proposal.blocks.map((b, i) =>
      i === idx && b.kind === "text" ? { ...b, title: draft.title, body: draft.body } : b,
    );
    const res = await patchProposal(proposal.id, { blocks });
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Saved");
    setEditing(null);
    const d = await fetchProposal(proposal.id);
    if (d) setDetail(d);
  };

  return (
    <div data-testid="bold-proposal-detail">
      <BoldMetaStrip
        items={[
          ["VALUE", bestAmount(proposal), "the leading option", "var(--cvb-forest)"],
          ["OPENS", "—", "arrives with sending"],
          ["STATUS", "Draft", "nothing sent yet"],
        ]}
      />
      <div style={{ display: "flex", gap: 18, padding: "14px 40px 0", borderBottom: "1px solid var(--cvb-line-inner)", alignItems: "center" }}>
        <span onClick={back} data-testid="bold-proposal-back" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)" }}>
          ← All documents
        </span>
        {TABS.map((t) => (
          <span key={t} onClick={() => setTab(t)} style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "6px 2px 12px", color: tab === t ? "var(--cvb-ink,#101613)" : "var(--cvb-faint)", borderBottom: tab === t ? "2px solid var(--cvb-forest)" : "2px solid transparent" }}>
            {t}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span title="Coming with delivery" data-testid="bold-proposal-send-deferred" style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-ghost)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 11, padding: "8px 14px", marginBottom: 6, cursor: "default" }}>
          Send — arrives with delivery
        </span>
      </div>

      <div style={{ padding: "22px 40px 40px" }}>
        {tab === "Document" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,660px) 210px", gap: 26, alignItems: "start" }} data-testid="bold-proposal-doc">
            <div>
              {proposal.blocks.map((b, i) => (
                <Block
                  key={i}
                  block={b}
                  editing={editing === i}
                  draft={draft}
                  setDraft={setDraft}
                  onEdit={
                    b.kind === "text"
                      ? () => {
                          setEditing(i);
                          setDraft({ title: b.title, body: b.body });
                        }
                      : undefined
                  }
                  onSave={() => void saveBlock(i)}
                  onCancel={() => setEditing(null)}
                />
              ))}
              <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 14, lineHeight: 1.6 }}>
                Text blocks edit in place today.
              </div>
            </div>
            {/* B5 review fix 1: the prototype's ADD A BLOCK palette, VISIBLY
                deferred — adding, moving and removing blocks is Q-103. */}
            <div data-testid="bold-proposal-palette" style={{ opacity: 0.6 }}>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 8 }}>ADD A BLOCK</div>
              {(
                [
                  ["◫", "Text section"],
                  ["◆", "Pricing options"],
                  ["▶", "Video"],
                  ["✎", "Signature"],
                  ["◧", "Cover"],
                ] as const
              ).map(([icon, name]) => (
                <div key={name} title="Coming soon" style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed var(--cvb-line-ctl)", borderRadius: 13, padding: "11px 13px", marginBottom: 8, cursor: "default" }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--cvb-panel)", color: "var(--cvb-faint)", fontSize: 12, flex: "none" }}>{icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-faint)" }}>{name}</span>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)", lineHeight: 1.55 }}>
                Coming soon — adding, moving and removing blocks arrives with the full editor.
              </div>
            </div>
          </div>
        ) : null}

        {tab === "Activity" ? (
          <div style={{ maxWidth: 640, border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: 22, fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }} data-testid="bold-proposal-activity">
            Opens, reading time and forwards land here once sending exists — a draft has no
            activity to report, and nothing here will ever be invented.
          </div>
        ) : null}

        {tab === "Settings" ? (
          <div style={{ maxWidth: 640, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>For</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 2 }}>{contactName ?? "No contact attached yet"}</div>
            </div>
            <div style={{ padding: "13px 15px", fontSize: 11.5, color: "var(--cvb-ghost)", lineHeight: 1.6 }}>
              Expiry, the deposit link, who can sign and open alerts all belong to delivery — they
              appear here when sending does.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Block({
  block,
  editing,
  draft,
  setDraft,
  onEdit,
  onSave,
  onCancel,
}: {
  block: BoldProposalBlock;
  editing: boolean;
  draft: { title: string; body: string };
  setDraft: (d: { title: string; body: string }) => void;
  onEdit?: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (block.kind === "cover") {
    return (
      <div style={{ background: "linear-gradient(150deg,#0C2A1B,#0A1524)", borderRadius: 18, padding: "26px 26px 28px", position: "relative", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ height: 2, background: "var(--cvb-gradient-signature, linear-gradient(90deg,#36D7ED,#35E834 55%,#D0F56B))", position: "absolute", top: 0, left: 0, right: 0 }} />
        {block.eyebrow ? <div style={{ ...mono, fontSize: 9, letterSpacing: ".18em", color: "rgba(255,255,255,.55)" }}>{block.eyebrow}</div> : null}
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em", color: "#fff", marginTop: 10 }}>{block.title}</div>
        {block.body ? <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 8 }}>{block.body}</div> : null}
      </div>
    );
  }
  if (block.kind === "text") {
    return (
      <div style={{ border: "1px solid var(--cvb-line)", borderRadius: 16, padding: "18px 20px", marginBottom: 14, background: "var(--cvb-card)", position: "relative" }}>
        {block.label ? <div style={{ ...mono, fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>{block.label}</div> : null}
        {editing ? (
          <div style={{ marginTop: 8 }}>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ width: "100%", fontSize: 15, fontWeight: 800, border: "1px solid var(--cvb-line-ctl)", borderRadius: 9, padding: "7px 10px" }} />
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} style={{ width: "100%", fontSize: 12.5, lineHeight: 1.55, border: "1px solid var(--cvb-line-ctl)", borderRadius: 9, padding: "8px 10px", marginTop: 8, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <span onClick={onCancel} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-faint)", cursor: "pointer", padding: "7px 11px" }}>Cancel</span>
              <span onClick={onSave} data-testid="bold-proposal-block-save" style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }}>Save</span>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 800, fontSize: 15, marginTop: 6 }}>{block.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 6 }}>{block.body}</div>
            {onEdit ? (
              <span onClick={onEdit} data-testid="bold-proposal-block-edit" style={{ position: "absolute", top: 12, right: 14, fontSize: 11, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", cursor: "pointer" }}>
                Edit
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  }
  if (block.kind === "price") {
    return (
      <div style={{ border: "1px solid var(--cvb-line)", borderRadius: 16, padding: "18px 20px", marginBottom: 14, background: "var(--cvb-card)" }}>
        {block.label ? <div style={{ ...mono, fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>{block.label}</div> : null}
        <div style={{ fontWeight: 800, fontSize: 15, marginTop: 6, marginBottom: 10 }}>{block.title}</div>
        {block.options.map((o) => (
          <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12, marginTop: 6, background: o.best ? "var(--cvb-mint)" : "var(--cvb-panel)", border: `1px solid ${o.best ? "var(--cvb-mint-line)" : "var(--cvb-line-inner)"}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{o.name}</div>
              {o.sub ? <div style={{ fontSize: 11, color: "var(--cvb-ghost)", marginTop: 1 }}>{o.sub}</div> : null}
            </div>
            <span style={{ fontWeight: 900, fontSize: 15, color: o.best ? "var(--cvb-forest)" : "var(--cvb-ink,#101613)" }}>{o.amount}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: "20px 20px 22px", marginBottom: 14, textAlign: "center" }}>
      {block.label ? <div style={{ ...mono, fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>{block.label}</div> : null}
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--cvb-faint)", marginTop: 8 }}>Sign here</div>
      {block.body ? <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 6 }}>{block.body}</div> : null}
      <div style={{ ...mono, fontSize: 9, color: "var(--cvb-ghost)", marginTop: 8 }}>signing arrives with delivery</div>
    </div>
  );
}
