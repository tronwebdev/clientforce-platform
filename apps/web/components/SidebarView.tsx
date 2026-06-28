import type { Me } from "../lib/types";
import { MAIN_NAV, TOOLS_NAV } from "./nav";

export interface SidebarViewProps {
  me: Me;
  activeKey: string;
  wsOpen: boolean;
  onToggleWs?: () => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSignOut?: () => void;
}

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
export function SidebarView({ me, activeKey, wsOpen, onToggleWs, onSelectWorkspace, onSignOut }: SidebarViewProps) {
  const activeWs = me.activeWorkspace;
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
          aria-haspopup="menu"
          aria-expanded={wsOpen}
          onClick={onToggleWs}
        >
          <span className="cf-sb__ws-badge">{(activeWs?.name ?? "W").slice(0, 1)}</span>
          <span className="cf-sb__ws-name">{activeWs?.name ?? "Select workspace"}</span>
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

      {/* Tools */}
      <div className="cf-sb__menu-head cf-sb__menu-head--section">Tools</div>
      <div className="cf-sb__nav">
        {TOOLS_NAV.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className={["cf-sb__item", "cf-sb__item--tool", item.key === activeKey ? "cf-sb__item--active" : ""]
              .filter(Boolean)
              .join(" ")}
            aria-current={item.key === activeKey ? "page" : undefined}
          >
            <span className="cf-sb__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="cf-sb__item-label">{item.label}</span>
            {item.badge ? <span className="cf-sb__badge">{item.badge}</span> : null}
          </a>
        ))}
      </div>

      <div className="cf-sb__menu-head cf-sb__menu-head--section">Help &amp; account</div>
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

      {/* Profile */}
      <div className="cf-sb__profile">
        <span className="cf-sb__avatar">{initials(me)}</span>
        <span className="cf-sb__profile-meta">
          <span className="cf-sb__profile-name">{me.user.name ?? me.user.email}</span>
          <span className="cf-sb__profile-role">{me.role}</span>
        </span>
        <button type="button" className="cf-sb__signout" onClick={onSignOut} aria-label="Sign out">
          ⏻
        </button>
      </div>
    </nav>
  );
}
