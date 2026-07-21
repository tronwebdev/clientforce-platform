import { redirect } from "next/navigation";
import { fetchMe } from "../../../lib/api";
import { AutomationsView } from "./AutomationsView";

/**
 * R1-UI (DEC-088) — the Automations surface (`Automations.dc.html`).
 * AutomationsView renders the prototype's own frame (page header + segment
 * tabs + When→Then cards), so no TopBar and no `.cf-content` wrapper here
 * (the Contacts precedent — the shell layout only mounts the sidebar).
 */
export default async function AutomationsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  return <AutomationsView role={me.role} />;
}
