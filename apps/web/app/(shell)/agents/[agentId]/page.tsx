import { redirect } from "next/navigation";

/** A5: the agent view lives at /agents/[agentId]/[tab] — bare id → inbox. */
export default async function AgentIndexPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  redirect(`/agents/${agentId}/inbox`);
}
