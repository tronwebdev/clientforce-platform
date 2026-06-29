import { redirect } from "next/navigation";
import { Card, Pill } from "@clientforce/ui";
import { TopBar } from "../../../components/TopBar";
import { fetchContacts, fetchMe } from "../../../lib/api";

function fullName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "—";
}

export default async function ContactsPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  const contacts = await fetchContacts();

  return (
    <>
      <TopBar title="Contacts" me={me} />
      <div className="cf-content">
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--cf-space-12)", marginBottom: "var(--cf-space-16)" }}>
            <h2 style={{ margin: 0, fontSize: "var(--cf-text-18)" }}>Contacts</h2>
            <Pill tone="neutral">{contacts.length}</Pill>
          </div>
          {contacts.length === 0 ? (
            <p className="cf-empty" data-testid="contacts-empty">No contacts in {me.activeWorkspace?.name ?? "this workspace"} yet.</p>
          ) : (
            <table className="cf-table" data-testid="contacts-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} data-testid="contact-row">
                    <td>{fullName(c)}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>{c.company ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
