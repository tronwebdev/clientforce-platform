import { redirect } from "next/navigation";
import { fetchAgents, fetchMe } from "../../../lib/api";
import { AgentsTable } from "./AgentsTable";

/**
 * C2.2: Agents List — server fetch (RLS-scoped), prototype-fidelity table.
 * No TopBar band: the prototype's Agents screen has no white top bar — the
 * in-canvas "Agents" header IS the page header (composition → prototype wins).
 */
export default async function AgentsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  const agents = await fetchAgents();
  return (
    // Bare wrapper with the prototype's exact main padding — .cf-content adds
    // its own 32px which stacked and narrowed the table (owner review nit).
    <div style={{ padding: "28px 30px 34px" }}>
      <AgentsTable initial={agents} />
    </div>
  );
}
