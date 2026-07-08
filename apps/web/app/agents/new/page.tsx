import { redirect } from "next/navigation";
import { fetchMe } from "../../../lib/api";
import { Wizard } from "./Wizard";

/**
 * C2.3 — Create Agent wizard. Lives OUTSIDE the (shell) route group: the
 * prototype (`Create Agent.dc.html`) is a standalone full-screen page with its
 * own top bar and step rail, no app sidebar.
 */
export default async function NewAgentPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  return <Wizard />;
}
