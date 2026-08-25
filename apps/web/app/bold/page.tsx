import { redirect } from "next/navigation";
import { BoldShell } from "../../components/bold/BoldShell";
import { fetchMe } from "../../lib/api";
import { clerkEnabled } from "../../lib/clerk";

export const metadata = { title: "Console — Clientforce" };

export default async function BoldConsolePage() {
  // Request-cached — the layout's call is shared, so this costs nothing extra.
  const me = await fetchMe();
  if (!me || "noWorkspace" in me) redirect(clerkEnabled ? "/sign-in" : "/login");
  return <BoldShell me={me} />;
}
