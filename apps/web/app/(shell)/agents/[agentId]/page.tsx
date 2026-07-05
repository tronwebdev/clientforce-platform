import { redirect } from "next/navigation";
import { Card, EmptyState } from "@clientforce/ui";
import { TopBar } from "../../../../components/TopBar";
import { fetchMe } from "../../../../lib/api";

/** C2.4 target — stub until the Agent view PR (Steps/Leads/Inbox/Logs/Settings). */
export default async function AgentViewPage({ params }: { params: Promise<{ agentId: string }> }) {
  const me = await fetchMe();
  if (!me) redirect("/login");
  const { agentId } = await params;
  return (
    <>
      <TopBar title="Agent" me={me} />
      <div className="cf-content">
        <Card>
          <EmptyState
            icon="◎"
            title="Agent view arrives with C2.4"
            body={`Steps, Leads, Inbox, Logs and Settings tabs for agent ${agentId} are the next UI PR.`}
            actions={<a className="cf-button cf-button--secondary" href="/agents" style={{ textDecoration: "none" }}>Back to Agents</a>}
          />
        </Card>
      </div>
    </>
  );
}
