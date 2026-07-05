import { redirect } from "next/navigation";
import { Card, EmptyState } from "@clientforce/ui";
import { TopBar } from "../../../../components/TopBar";
import { fetchMe } from "../../../../lib/api";

/** C2.3 target — the 6-step Create Agent wizard is the next UI PR. */
export default async function NewAgentPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  return (
    <>
      <TopBar title="New agent" me={me} />
      <div className="cf-content">
        <Card>
          <EmptyState
            icon="✦"
            title="Create Agent wizard arrives with C2.3"
            body="Goal cards, knowledge base, AI-drafted sequence, contacts and senders — the full 6-step flow is the next UI PR."
            actions={<a className="cf-button cf-button--secondary" href="/agents" style={{ textDecoration: "none" }}>Back to Agents</a>}
          />
        </Card>
      </div>
    </>
  );
}
