import type { Me } from "../lib/types";

export function TopBar({ title, me }: { title: string; me: Me }) {
  return (
    <header className="cf-topbar">
      <h1 className="cf-topbar__title">{title}</h1>
      <div className="cf-topbar__ctx">
        <span className="cf-topbar__ws">{me.activeWorkspace?.name ?? "No workspace"}</span>
      </div>
    </header>
  );
}
