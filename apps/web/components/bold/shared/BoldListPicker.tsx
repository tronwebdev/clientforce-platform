"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContactListDto } from "@clientforce/core";
import { fetchLists } from "../bold-live";

/**
 * The SHARED Bold list picker (B2.5, DEC-108): a modal over the shipped
 * `GET /lists` read — search, live member counts, archived lists never
 * offered (the C2.8 rule). Built here per DEC-107(3) so B3's contacts
 * surface consumes the same component; the legacy wizard's inline Step-3
 * modal is the composition reference, this is the Bold-canon home.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

/** Deterministic list glyph tint (the packages/ui listGlyph convention,
 *  re-toned in Bold tokens — icons are skin, determinism is the rule). */
function listTint(name: string): { bg: string; fg: string } {
  const tints: Array<[string, string]> = [
    ["var(--cvb-mint)", "var(--cvb-forest)"],
    ["var(--cvb-cyan-tint)", "var(--cvb-cyan)"],
    ["var(--cvb-slate-tint)", "var(--cvb-slate)"],
    ["var(--cvb-amber-bg)", "var(--cvb-amber)"],
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = tints[h % tints.length]!;
  return { bg, fg };
}

export function BoldListPicker({
  onPick,
  onClose,
}: {
  onPick: (list: ContactListDto) => void;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<ContactListDto[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    void fetchLists().then((l) => setLists((l ?? []).filter((x) => !x.archived)));
  }, []);

  const shown = useMemo(
    () => (lists ?? []).filter((l) => l.name.toLowerCase().includes(q.toLowerCase())),
    [lists, q],
  );

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,.14)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 6 }}
      onClick={onClose}
    >
      <div
        data-testid="bold-list-picker"
        style={{ width: 480, maxWidth: "92%", maxHeight: "80%", background: "var(--cvb-card)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: 22, display: "flex", flexDirection: "column", animation: "cvb-over .32s var(--cvb-ease) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>Choose a list</div>
            <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 3 }}>Members enroll at launch — as of launch day.</div>
          </div>
          <span
            role="button"
            aria-label="Close"
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 11, border: "1px solid var(--cvb-line-ctl)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cvb-muted)", fontSize: 13, cursor: "pointer", flex: "none" }}
          >
            ✕
          </span>
        </div>
        <input
          autoFocus
          placeholder="Search lists"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="bold-list-picker-search"
          style={{ marginTop: 14, background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" }}
        />
        <div style={{ marginTop: 10, overflowY: "auto", flex: 1, minHeight: 0 }}>
          {lists === null ? (
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", padding: "14px 4px" }}>LOADING LISTS</div>
          ) : shown.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cvb-muted)" }}>
                {q ? "No lists match" : "No saved lists yet"}
              </div>
              <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 5 }}>
                {q ? "Try another search." : "Import a CSV instead — it lands in a list you can reuse."}
              </div>
            </div>
          ) : (
            shown.map((l) => {
              const tint = listTint(l.name);
              return (
                <div
                  key={l.id}
                  onClick={() => onPick(l)}
                  data-testid={`bold-list-pick-${l.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderRadius: 12, cursor: "pointer" }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 12, flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                    ☰
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.018em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                    <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 2 }}>
                      {l.memberCount} contact{l.memberCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", flex: "none" }}>Choose</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
