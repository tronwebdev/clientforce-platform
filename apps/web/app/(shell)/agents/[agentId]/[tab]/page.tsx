import { notFound, redirect } from "next/navigation";
import { fetchMe } from "../../../../../lib/api";
import { AgentView } from "./AgentView";
import { TABS } from "./shared";

/**
 * C2.4 — Agent view (checkpoints §4), `/agents/[agentId]/[tab]` per A5.
 * Wired: inbox · steps · leads · settings · logs. Inert (visible, §4):
 * calls · preview · stats.
 */
export default async function AgentTabPage({
  params,
}: {
  params: Promise<{ agentId: string; tab: string }>;
}) {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;
  const { agentId, tab } = await params;
  if (!TABS.some((t) => t.id === tab)) notFound();
  return <AgentView agentId={agentId} tab={tab} />;
}
