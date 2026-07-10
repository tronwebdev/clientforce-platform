import { redirect } from "next/navigation";
import { fetchMe } from "../../../lib/api";
import { ContactsView } from "./ContactsView";

/**
 * C2.5 — Contacts (checkpoints §5). ContactsView renders the prototype's own
 * frame — 226px lists rail + main column with page header — so no TopBar and
 * no `.cf-content` wrapper here (the shell layout only mounts the sidebar).
 */
export default async function ContactsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  return <ContactsView />;
}
