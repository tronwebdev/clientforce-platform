import { redirect } from "next/navigation";
import { Card } from "@clientforce/ui";
import { TopBar } from "../../../components/TopBar";
import { fetchMe } from "../../../lib/api";
import type { Role } from "../../../lib/types";
import { SettingsView } from "./SettingsView";

/** Settings is role-gated (auth + role guard, same policy as the section shim). */
const ALLOWED: Role[] = ["OWNER", "ADMIN"];

/**
 * C2.6 — workspace Settings (checkpoints §6). SettingsView renders the
 * prototype's own frame — page header + 226px sub-nav rail — so no TopBar
 * and no `.cf-content` wrapper on the allowed path (the shell layout only
 * mounts the sidebar). The forbidden branch keeps the existing treatment.
 */
export default async function SettingsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;

  if (!ALLOWED.includes(me.role)) {
    return (
      <>
        <TopBar title="Settings" me={me} />
        <div className="cf-content">
          <Card>
            <h2 style={{ marginTop: 0, fontSize: "var(--cf-text-18)", color: "var(--cf-color-danger)" }}>
              Insufficient permissions
            </h2>
            <p style={{ color: "var(--cf-color-muted-2)" }}>
              Settings requires {ALLOWED.join(" or ")}. You are signed in as {me.role}.
            </p>
          </Card>
        </div>
      </>
    );
  }

  return <SettingsView />;
}
