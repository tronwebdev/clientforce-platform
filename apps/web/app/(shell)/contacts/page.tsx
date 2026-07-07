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
  return <ContactsView />;
}
