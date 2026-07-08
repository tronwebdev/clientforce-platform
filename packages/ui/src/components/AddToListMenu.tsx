/**
 * C2.8 (docs/PLAN_CONTACT_LISTS.md) — the ONE Add-to-list menu, mounted
 * everywhere leads/contacts appear (owner unification rule): Contacts bulk
 * bar, contact detail drawer, Campaign View Leads-tab bulk bar, lead detail
 * drawer. The v4 `Contacts.dc.html` menu anatomy is the binding pattern:
 * uppercase header · list rows (24px icon chip + name + count OR ✓ current) ·
 * green "＋ New list [from selection]" footer. Data-driven — the mounts fetch
 * lists and handle picks; triggers stay mount-local (bulk "≣" chip vs the
 * drawer's green "＋ Add to list").
 */

export interface AddToListOption {
  id: string;
  name: string;
  /** Member count — rendered on bulk mounts (prototype bulk menu). */
  count?: number;
  /** Renders the ✓ (prototype drawer menu — the contact's current list). */
  current?: boolean;
}

/** Prototype list glyph mapping (`listIcon`/`listIconBg`) — verbatim. */
export function listGlyph(name: string): { icon: string; iconBg: string } {
  if (/dental/i.test(name)) return { icon: "🦷", iconBg: "rgba(53,232,52,.16)" };
  if (/saas/i.test(name)) return { icon: "🚀", iconBg: "rgba(208,245,107,.3)" };
  if (/agenc/i.test(name)) return { icon: "🏢", iconBg: "rgba(54,215,237,.16)" };
  if (/webinar/i.test(name)) return { icon: "🎥", iconBg: "#F2EEE4" };
  return { icon: "📁", iconBg: "#F2EEE4" };
}

export interface AddToListMenuProps {
  /** Uppercase header, e.g. "Add 3 to list" (bulk) or "Add to list" (drawer). */
  header: string;
  options: AddToListOption[];
  /** Footer label: "＋ New list from selection" (bulk) / "＋ New list" (drawer). */
  newListLabel: string;
  onPick: (listId: string) => void;
  onNewList: () => void;
  /** Show member counts (bulk mounts) instead of the ✓ column (drawer mounts). */
  showCounts?: boolean;
  testid?: string;
}

/** The 248px menu panel — position it inside a `position: relative` trigger wrapper. */
export function AddToListMenu({
  header,
  options,
  newListLabel,
  onPick,
  onNewList,
  showCounts = false,
  testid = "add-to-list-menu",
}: AddToListMenuProps) {
  return (
    <div
      data-testid={testid}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: 248,
        background: "#fff",
        border: "1px solid #EBE3D6",
        borderRadius: 12,
        boxShadow: "0 16px 44px rgba(0,0,0,.18)",
        overflow: "hidden",
        zIndex: 14,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "#9AA59E",
          padding: "10px 14px 5px",
        }}
      >
        {header}
      </div>
      <div style={{ maxHeight: 212, overflowY: "auto" }}>
        {options.map((o) => {
          const glyph = listGlyph(o.name);
          return (
            <div
              key={o.id}
              onClick={() => onPick(o.id)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#FBF7F0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer" }}
              data-testid={`${testid}-opt`}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  flex: "none",
                  background: glyph.iconBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                }}
              >
                {glyph.icon}
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#0E1512",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {o.name}
              </span>
              {showCounts ? (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#9AA59E" }}>{o.count ?? 0}</span>
              ) : (
                <span style={{ color: "#16A82A", visibility: o.current ? "visible" : "hidden" }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
      <div
        onClick={onNewList}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(53,232,52,.06)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 14px",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          color: "#16A82A",
          borderTop: "1px solid #EBE3D6",
        }}
        data-testid={`${testid}-new`}
      >
        <span>＋</span> {newListLabel}
      </div>
    </div>
  );
}
