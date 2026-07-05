import { isToolKey, MAIN_NAV, TOOLS_NAV } from "./nav";
import type { Me } from "../lib/types";

export interface SidebarViewProps {
  me: Me;
  activeKey: string;
  wsOpen: boolean;
  toolsOpen: boolean;
  helpOpen?: boolean;
  profileOpen?: boolean;
  onToggleWs?: () => void;
  onToggleTools?: () => void;
  onToggleHelp?: () => void;
  onToggleProfile?: () => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSignOut?: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Agency owner",
  ADMIN: "Admin",
  AGENT: "Agent",
  VIEWER: "Viewer",
};

function initials(me: Me): string {
  const base = me.user.name ?? me.user.email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Pure presentational sidebar (no hooks) — rebuilt from prototypes/sidebar.js on
 * @clientforce/ui tokens. The client wrapper supplies pathname-derived active
 * state and the switch/sign-out handlers.
 */
export function SidebarView({
  me,
  activeKey,
  wsOpen,
  toolsOpen,
  helpOpen,
  profileOpen,
  onToggleWs,
  onToggleTools,
  onToggleHelp,
  onToggleProfile,
  onSelectWorkspace,
  onSignOut,
}: SidebarViewProps) {
  const activeWs = me.activeWorkspace;
  const toolsActive = isToolKey(activeKey);
  return (
    <nav className="cf-sb" aria-label="Primary">
      <a className="cf-sb__brand" href="/">
        <span className="cf-sb__mark">f</span>
        <span className="cf-sb__wordmark">Clientforce</span>
      </a>

      {/* Workspace switcher */}
      <div className="cf-sb__ws-wrap">
        <button
          type="button"
          className="cf-sb__ws"
          data-testid="ws-switcher"
          aria-haspopup="menu"
          aria-expanded={wsOpen}
          onClick={onToggleWs}
        >
          <span className="cf-sb__ws-badge">{(activeWs?.name ?? "W").slice(0, 1)}</span>
          <span className="cf-sb__ws-name" data-testid="ws-active-name">{activeWs?.name ?? "Select workspace"}</span>
          <span className="cf-sb__chev" aria-hidden="true">
            {wsOpen ? "▴" : "▾"}
          </span>
        </button>
        {wsOpen ? (
          <div className="cf-sb__ws-menu" role="menu" aria-label="Switch workspace">
            <div className="cf-sb__menu-head">Switch workspace</div>
            {me.memberships.map((m) => (
              <button
                key={m.workspaceId}
                type="button"
                role="menuitemradio"
                data-testid={`ws-option-${m.workspace.slug}`}
                aria-checked={m.workspaceId === activeWs?.id}
                className="cf-sb__ws-item"
                onClick={() => onSelectWorkspace?.(m.workspaceId)}
              >
                <span className="cf-sb__ws-badge cf-sb__ws-badge--sm">{m.workspace.name.slice(0, 1)}</span>
                <span className="cf-sb__ws-item-name">{m.workspace.name}</span>
                {m.workspaceId === activeWs?.id ? (
                  <span className="cf-sb__check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Primary nav */}
      <div className="cf-sb__nav">
        {MAIN_NAV.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className={["cf-sb__item", item.key === activeKey ? "cf-sb__item--active" : ""].filter(Boolean).join(" ")}
            aria-current={item.key === activeKey ? "page" : undefined}
          >
            <span className="cf-sb__icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </a>
        ))}
      </div>

      {/* Tools — collapsed rail item that opens a right-side flyout (sidebar.js) */}
      <div className="cf-sb__tools-wrap">
        <button
          type="button"
          className={["cf-sb__item", "cf-sb__tools-toggle", toolsActive ? "cf-sb__item--active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
          onClick={onToggleTools}
        >
          <span className="cf-sb__icon" aria-hidden="true">
            ⚒
          </span>
          <span className="cf-sb__item-label">Tools</span>
          <span className="cf-sb__chev" aria-hidden="true">
            {toolsOpen ? "▾" : "▸"}
          </span>
        </button>
        {toolsOpen ? (
          <div className="cf-sb__tools-menu" role="menu" aria-label="Tools">
            <div className="cf-sb__menu-head">Tools</div>
            {TOOLS_NAV.map((item) => {
              const on = item.key === activeKey;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  className={["cf-sb__item", "cf-sb__item--tool", on ? "cf-sb__item--active" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={on ? "page" : undefined}
                >
                  <span className="cf-sb__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="cf-sb__item-label">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={[
                        "cf-sb__badge",
                        item.badgeStyle === "cyan" ? "cf-sb__badge--cyan" : "cf-sb__badge--grad",
                      ].join(" ")}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="cf-sb__menu-head cf-sb__menu-head--section">Help &amp; account</div>
      {/* Help — §1: 240px flyout (Help center / What's new / Contact support) */}
      <div className="cf-sb__help-wrap">
        <button
          type="button"
          className="cf-sb__item cf-sb__tools-toggle"
          aria-haspopup="menu"
          aria-expanded={helpOpen}
          onClick={onToggleHelp}
        >
          <span className="cf-sb__icon" aria-hidden="true">
            ?
          </span>
          <span className="cf-sb__item-label">Help</span>
        </button>
        {helpOpen ? (
          <div className="cf-sb__help-menu" role="menu" aria-label="Help">
            {[
              { label: "Help center", href: "/help" },
              { label: "What's new", href: "/help" },
              { label: "Contact support", href: "/help" },
            ].map((h) => (
              <a key={h.label} href={h.href} role="menuitem" className="cf-sb__item cf-sb__item--tool">
                <span className="cf-sb__item-label">{h.label}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <a
        href="/settings"
        className={["cf-sb__item", activeKey === "settings" ? "cf-sb__item--active" : ""].filter(Boolean).join(" ")}
        aria-current={activeKey === "settings" ? "page" : undefined}
      >
        <span className="cf-sb__icon" aria-hidden="true">
          ⚙
        </span>
        Settings
      </a>

      {/* Profile — sidebar.js: chevron opens the account flyout (sign out lives there) */}
      <div className="cf-sb__profile-wrap">
        <button
          type="button"
          className="cf-sb__profile"
          aria-haspopup="menu"
          aria-expanded={profileOpen}
          onClick={onToggleProfile}
        >
          <span className="cf-sb__avatar">{initials(me)}</span>
          <span className="cf-sb__profile-meta">
            <span className="cf-sb__profile-name">{me.user.name ?? me.user.email}</span>
            <span className="cf-sb__profile-role">{ROLE_LABEL[me.role] ?? me.role}</span>
          </span>
          <span className="cf-sb__chev" aria-hidden="true">
            {profileOpen ? "\u2303" : "\u2304"}
          </span>
        </button>
        {profileOpen ? (
          <div className="cf-sb__profile-menu" role="menu" aria-label="Account">
            <a className="cf-sb__profile-item" role="menuitem" href="/settings">
              <span className="cf-sb__icon" aria-hidden="true">☺</span>
              Account
            </a>
            <a className="cf-sb__profile-item" role="menuitem" href="/settings">
              <span className="cf-sb__icon" aria-hidden="true">⚙</span>
              Settings
            </a>
            <button
              type="button"
              className="cf-sb__profile-item cf-sb__profile-item--danger"
              role="menuitem"
              data-testid="sign-out"
              onClick={onSignOut}
            >
              <span className="cf-sb__icon" aria-hidden="true">⏻</span>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
