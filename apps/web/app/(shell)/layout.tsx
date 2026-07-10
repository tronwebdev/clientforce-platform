import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "../../components/Sidebar";
import { FirstRunWorkspace } from "../../components/FirstRunWorkspace";
import { fetchMe } from "../../lib/api";
import { clerkEnabled } from "../../lib/clerk";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  if (!me) redirect(clerkEnabled ? "/sign-in" : "/login");
  // A3 (DEC-060): authenticated, zero memberships → minimal first-run modal
  // (system anatomy — NOT the Onboarding.dc.html flow, which stays out of scope).
  if ("noWorkspace" in me) return <FirstRunWorkspace />;
  return (
    <div className="cf-shell-layout">
      <Sidebar me={me} />
      <div className="cf-main">{children}</div>
    </div>
  );
}
