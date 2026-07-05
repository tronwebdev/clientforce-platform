import { redirect } from "next/navigation";
import { Card, EmptyState } from "@clientforce/ui";
import { TopBar } from "../../../components/TopBar";
import { fetchMe } from "../../../lib/api";

/** C2.1: Dashboard is a designed empty-state stub this phase (handoff §C). */
export default async function DashboardPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  return (
    <>
      <TopBar title="Dashboard" me={me} />
      <div className="cf-content">
        <Card>
          <EmptyState
            icon="\u25c8"
            title="Your dashboard is coming"
            body="Cross-agent analytics land in a later phase. Everything running today lives under Agents."
            actions={<a className="cf-button cf-button--primary" href="/agents" style={{ textDecoration: "none" }}>Go to Agents</a>}
          />
        </Card>
      </div>
    </>
  );
}
