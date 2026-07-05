import { notFound, redirect } from "next/navigation";
import { fetchMe } from "../../../../../lib/api";
import { AgentView, TABS } from "./AgentView";

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
  const { agentId, tab } = await params;
  if (!TABS.some((t) => t.id === tab)) notFound();
  return <AgentView agentId={agentId} tab={tab} />;
}
