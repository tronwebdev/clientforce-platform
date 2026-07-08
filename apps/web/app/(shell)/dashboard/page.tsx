import { redirect } from "next/navigation";
import { Card, EmptyState } from "@clientforce/ui";
import { TopBar } from "../../../components/TopBar";
import { fetchMe } from "../../../lib/api";

/** C2.1: Dashboard is a designed empty-state stub this phase (handoff §C). */
export default async function DashboardPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
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
