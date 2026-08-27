"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContactListDto } from "@clientforce/core";
import type { BoldDrawerState } from "./BoldDrawer";
import { BoldCsvImport, type CsvImportOutcome } from "./shared/BoldCsvImport";
import {
  addContactsToList,
  avTint,
  contactName,
  createContactList,
  fetchContactsView,
  fetchLists,
  initials,
  money,
  type BoldContactRow,
} from "./bold-live";

/**
 * Contacts (B3a, prototype `vContacts` + §7, DEC-112) — everything renders
 * from the SHIPPED C2.5 contacts view. The prototype's fixture anatomy maps
 * to real data honestly:
 *  - Segments All · Customers · Prospects are DERIVED queries over the latest
 *    enrollment's stage (won = Customer, else Prospect — the same factual rule
 *    as the row pill; a stored customer/prospect type does not exist, Q-077).
 *  - The row pill adds Booked between them, exactly the prototype's third tag;
 *    unsubscribed rows say so (their state outranks the segment tag).
 *  - Avatars are the repo's initials+tint convention — no photo data exists
 *    (Q-068); the prototype's stock photos are its fixture.
 *  - VALUE is the campaign's owner-entered per-win estimate and renders under
 *    the B1 "potential" vocabulary on goal-reached rows only (booked/won) —
 *    nothing claims a payment (DEC-104/105).
 *  - Lists chips + "+ New list" and "Import a CSV" are the live B2.5 writes
 *    (`POST /lists`, the shared CSV mapper). Add-to-list is available on every
 *    row (§7 ruling) and in the person drawer.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

type Seg = "All" | "Customers" | "Prospects";

/** The ONE factual tag derivation (drawer + page use the same rule). */
export function contactTag(row: BoldContactRow): "Customer" | "Booked" | "Prospect" | "Unsubscribed" {
  if (row.unsub) return "Unsubscribed";
  if (row.stage === "won") return "Customer";
  if (row.stage === "booked") return "Booked";
  return "Prospect";
}
const TAG_TONE: Record<string, [string, string, string]> = {
  Customer: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  Booked: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)"],
  Prospect: ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"],
  Unsubscribed: ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce"],
};

export function BoldContactsView({
  onOpenDrawer,
  flash,
  onCount,
}: {
  onOpenDrawer: (d: BoldDrawerState) => void;
  flash: (msg: string) => void;
  /** Reports the workspace's live people count for the eyebrow. */
  onCount?: (n: number) => void;
}) {
  const [rows, setRows] = useState<BoldContactRow[] | null>(null);
  const [lists, setLists] = useState<ContactListDto[]>([]);
  const [seg, setSeg] = useState<Seg>("All");
  const [listF, setListF] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState(true);
  const [csvOpen, setCsvOpen] = useState(false);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [addListFor, setAddListFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [view, ls] = await Promise.all([fetchContactsView(), fetchLists()]);
    if (view) {
      setRows(view.rows);
      onCount?.(view.rows.length);
    }
    setLists((ls ?? []).filter((l) => !l.archived));
  }, [onCount]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (listF && !r.lists.some((l) => l.id === listF)) return false;
      const tag = contactTag(r);
      if (seg === "Customers" && tag !== "Customer") return false;
      if (seg === "Prospects" && (tag === "Customer" || tag === "Unsubscribed")) return false;
      if (!q) return true;
      const hay = [contactName(r), r.email, r.phone, r.company, r.agentName, tag, ...r.lists.map((l) => l.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, seg, listF, query]);

  async function createList() {
    const name = newListName.trim();
    if (!name) return;
    const res = await createContactList(name, "manual");
    if (!res.ok) {
      flash(res.error);
      return;
    }
    setNewListOpen(false);
    setNewListName("");
    flash(`List “${name}” created.`);
    void refresh();
  }
  async function addToList(row: BoldContactRow, list: ContactListDto) {
    setAddListFor(null);
    const res = await addContactsToList(list.id, [row.id]);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    const added = (res.body as { added?: number } | null)?.added ?? 0;
    flash(added === 0 ? `Already in “${list.name}” — nothing to add.` : `Added to “${list.name}”.`);
    void refresh();
  }
  function onImported(outcome: CsvImportOutcome) {
    setCsvOpen(false);
    flash(`Imported ${outcome.result.created} into “${outcome.listName}”.`);
    void refresh();
  }

  /** Sub line: the latest campaign + stage — real words only, else the source. */
  const subOf = (r: BoldContactRow) =>
    r.agentName && r.stage ? `${r.agentName} · ${r.stage}` : r.source.replace(/_/g, " ");
  /** DEC-104/105 value honesty: the per-win estimate on goal-reached rows only. */
  const valueOf = (r: BoldContactRow) =>
    r.valueEstCents != null && (r.stage === "booked" || r.stage === "won") ? money(r.valueEstCents) : "—";
  const openPerson = (r: BoldContactRow) =>
    onOpenDrawer({
      t: "person",
      contact: { id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email },
      row: r,
    });

  if (rows === null) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-contacts">
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>LOADING CONTACTS</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-contacts">
      {/* seg toggle + Import a CSV */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, background: "var(--cvb-well)", borderRadius: 13, padding: 4, width: "fit-content" }}>
          {(["All", "Customers", "Prospects"] as const).map((l) => (
            <span
              key={l}
              onClick={() => {
                setSeg(l);
                setListF(null);
              }}
              data-testid={`bold-ct-seg-${l.toLowerCase()}`}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: "9px 16px",
                borderRadius: 10,
                cursor: "pointer",
                background: seg === l ? "var(--cvb-card)" : "transparent",
                color: seg === l ? "var(--cvb-ink)" : "var(--cvb-faint)",
              }}
            >
              {l}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span
          onClick={() => setCsvOpen((v) => !v)}
          data-testid="bold-ct-import"
          style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 16px", cursor: "pointer" }}
        >
          Import a CSV
        </span>
      </div>

      {/* lists chip row */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 20, flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", marginRight: 3 }}>LISTS</span>
        {lists.map((l) => {
          const on = listF === l.id;
          return (
            <span
              key={l.id}
              onClick={() => setListF(on ? null : l.id)}
              data-testid={`bold-ct-list-${l.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11.5,
                fontWeight: 600,
                padding: "7px 12px",
                borderRadius: 999,
                cursor: "pointer",
                background: on ? "var(--cvb-mint)" : "var(--cvb-card)",
                color: on ? "var(--cvb-forest)" : "var(--cvb-muted)",
                border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                whiteSpace: "nowrap",
              }}
            >
              {l.name}
              <span style={{ ...mono, fontSize: 10, color: on ? "var(--cvb-forest)" : "var(--cvb-faint)" }}>{l.memberCount}</span>
            </span>
          );
        })}
        <span style={{ position: "relative" }}>
          <span
            onClick={() => setNewListOpen((v) => !v)}
            data-testid="bold-ct-newlist"
            style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan)", padding: "7px 10px", cursor: "pointer" }}
          >
            + New list
          </span>
          {newListOpen ? (
            <span style={{ position: "absolute", left: 0, top: "100%", marginTop: 5, width: 230, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 10, zIndex: 5, boxShadow: "var(--cvb-shadow-card)", display: "flex", gap: 7 }}>
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createList();
                }}
                placeholder="List name"
                data-testid="bold-ct-newlist-name"
                style={{ flex: 1, minWidth: 0, fontSize: 12.5, border: "1px solid var(--cvb-line-ctl)", borderRadius: 9, padding: "8px 10px", background: "var(--cvb-panel)", color: "var(--cvb-ink)", outline: "none" }}
              />
              <span
                onClick={() => void createList()}
                data-testid="bold-ct-newlist-save"
                style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 9, padding: "8px 12px", cursor: "pointer", flex: "none" }}
              >
                Create
              </span>
            </span>
          ) : null}
        </span>
      </div>

      {/* search + view toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 200, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 14, padding: "11px 14px" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cvb-faint)" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-5-5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            data-testid="bold-ct-search"
            style={{ flex: 1, minWidth: 0, fontSize: 13, border: "none", outline: "none", background: "transparent", color: "var(--cvb-ink)" }}
          />
          {query ? (
            <span onClick={() => setQuery("")} style={{ fontSize: 12, color: "var(--cvb-faint)", cursor: "pointer", flex: "none" }}>
              ✕
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 3, background: "var(--cvb-well)", borderRadius: 12, padding: 3, flex: "none" }}>
          {(
            [
              [true, "▦", "Cards"],
              [false, "☰", "List"],
            ] as const
          ).map(([g, ic, t]) => (
            <span
              key={t}
              onClick={() => setGrid(g)}
              title={t}
              data-testid={`bold-ct-view-${t.toLowerCase()}`}
              style={{ width: 34, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: grid === g ? "var(--cvb-card)" : "transparent", color: grid === g ? "var(--cvb-ink)" : "var(--cvb-faint)", fontSize: 13 }}
            >
              {ic}
            </span>
          ))}
        </div>
      </div>

      {csvOpen ? (
        <div style={{ marginTop: 18 }}>
          <BoldCsvImport onImported={onImported} flash={flash} />
        </div>
      ) : null}

      {/* grid */}
      {grid && shown.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(186px,1fr))", gap: 12, marginTop: 18 }}>
          {shown.map((r) => {
            const tag = contactTag(r);
            const tone = TAG_TONE[tag]!;
            const tint = avTint(r.id);
            return (
              <div
                key={r.id}
                onClick={() => openPerson(r)}
                data-testid={`bold-ct-card-${r.id}`}
                style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: "22px 18px 18px", cursor: "pointer" }}
              >
                <span style={{ width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: tint.bg, color: tint.fg, fontSize: 18, fontWeight: 900 }}>
                  {initials(r)}
                </span>
                <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", marginTop: 13 }}>{contactName(r)}</div>
                <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subOf(r)}</div>
                <div style={{ ...mono, fontSize: 10, color: "var(--cvb-muted)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.email ?? undefined}>
                  {r.email ?? "—"}
                </div>
                <div style={{ ...mono, fontSize: 10, color: r.phone ? "var(--cvb-muted)" : "var(--cvb-ghost)", marginTop: 3, whiteSpace: "nowrap" }}>{r.phone ?? "—"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tone[0], background: tone[1], border: `1px solid ${tone[2]}`, borderRadius: 999, padding: "3px 9px" }}>{tag}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)" }} title="The campaign’s per-win estimate — potential, not a payment">
                    {valueOf(r)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* list */}
      {!grid && shown.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px 9px", borderBottom: "1px solid var(--cvb-line)" }}>
            <span style={{ width: 34, flex: "none" }} />
            <span style={{ flex: 1, minWidth: 120, ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>NAME</span>
            <span style={{ width: 186, flex: "none", ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>EMAIL</span>
            <span style={{ width: 132, flex: "none", ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>PHONE</span>
            <span style={{ width: 96, flex: "none", ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>STATUS</span>
            <span style={{ width: 64, flex: "none", textAlign: "right", ...mono, fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }} title="The campaign’s per-win estimate — potential, not a payment">
              POTENTIAL
            </span>
            <span style={{ width: 60, flex: "none" }} />
          </div>
          {shown.map((r) => {
            const tag = contactTag(r);
            const tone = TAG_TONE[tag]!;
            const tint = avTint(r.id);
            return (
              <div
                key={r.id}
                onClick={() => openPerson(r)}
                data-testid={`bold-ct-row-${r.id}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderBottom: "1px solid var(--cvb-line-2)", cursor: "pointer" }}
              >
                <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
                  {initials(r)}
                </span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.018em" }}>{contactName(r)}</div>
                  <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 2 }}>{subOf(r)}</div>
                </div>
                <span style={{ width: 186, flex: "none", ...mono, fontSize: 10.5, color: "var(--cvb-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.email ?? undefined}>
                  {r.email ?? "—"}
                </span>
                <span style={{ width: 132, flex: "none", ...mono, fontSize: 10.5, color: r.phone ? "var(--cvb-muted)" : "var(--cvb-ghost)", whiteSpace: "nowrap" }}>{r.phone ?? "—"}</span>
                <span style={{ width: 96, flex: "none" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tone[0], background: tone[1], border: `1px solid ${tone[2]}`, borderRadius: 999, padding: "3px 9px" }}>{tag}</span>
                </span>
                <span className="cvb-display" style={{ width: 64, flex: "none", textAlign: "right", fontWeight: 900, fontSize: 14, letterSpacing: "-.024em" }}>
                  {valueOf(r)}
                </span>
                <span style={{ width: 60, flex: "none", textAlign: "right", position: "relative" }}>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddListFor((v) => (v === r.id ? null : r.id));
                    }}
                    data-testid={`bold-ct-addlist-${r.id}`}
                    style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer" }}
                  >
                    + List
                  </span>
                  {addListFor === r.id ? (
                    <span
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: "absolute", right: 0, top: "100%", marginTop: 5, width: 200, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 5, boxShadow: "var(--cvb-shadow-card)", display: "block", textAlign: "left" }}
                    >
                      {lists.map((l) => (
                        <span key={l.id} onClick={() => void addToList(r, l)} style={{ display: "block", padding: "9px 10px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
                          {l.name}
                          <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginLeft: 6 }}>{l.memberCount}</span>
                        </span>
                      ))}
                      {lists.length === 0 ? <span style={{ display: "block", padding: "9px 10px", fontSize: 12, color: "var(--cvb-faint)" }}>No lists yet.</span> : null}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div style={{ textAlign: "center", padding: "56px 20px" }} data-testid="bold-ct-empty">
          {query ? (
            <>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>Nobody matches “{query}”</div>
              <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 8 }}>
                Search runs across names, emails, phones, lists and campaigns.
              </div>
            </>
          ) : (
            <>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>Nobody here yet</div>
              <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 8 }}>
                Import a CSV or add people from a campaign.
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
