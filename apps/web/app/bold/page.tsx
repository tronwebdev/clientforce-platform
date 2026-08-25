import { redirect } from "next/navigation";
import { BoldShell } from "../../components/bold/BoldShell";
import { fetchAgents, fetchMe, fetchMeNeeds } from "../../lib/api";
import { clerkEnabled } from "../../lib/clerk";

export const metadata = { title: "Console — Clientforce" };

export default async function BoldConsolePage() {
  // Request-cached — the layout's call is shared, so this costs nothing extra.
  const me = await fetchMe();
  if (!me || "noWorkspace" in me) redirect(clerkEnabled ? "/sign-in" : "/login");
  // B1: the rail campaign list + the cross-workspace needs pill are LIVE reads.
  const [agents, needs] = await Promise.all([
    fetchAgents().catch(() => []),
    fetchMeNeeds(),
  ]);
  return <BoldShell me={me} initialAgents={agents} needs={needs} />;
}
