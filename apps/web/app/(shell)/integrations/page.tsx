import { redirect } from "next/navigation";
import { fetchMe } from "../../../lib/api";
import { IntegrationsView } from "./IntegrationsView";

/**
 * INT W1-UI — the Integrations surface (`Integrations.dc.html`).
 * IntegrationsView renders the prototype's own frame (page header + search +
 * category pills + 3-col card grid), so no TopBar and no `.cf-content`
 * wrapper here (the Automations precedent — the shell layout only mounts the
 * sidebar). This static segment shadows the `[section]` placeholder page.
 */
export default async function IntegrationsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  return <IntegrationsView role={me.role} />;
}
