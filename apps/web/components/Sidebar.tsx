"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Me } from "../lib/types";
import { activeKeyFor } from "./nav";
import { SidebarView } from "./SidebarView";

/** Client wrapper: pathname-derived active state + switch/sign-out behavior. */
export function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const router = useRouter();
  const [wsOpen, setWsOpen] = useState(false);

  async function selectWorkspace(workspaceId: string) {
    if (workspaceId === me.activeWorkspace?.id) {
      setWsOpen(false);
      return;
    }
    await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setWsOpen(false);
    // Re-fetch server components with the new tenant context.
    router.refresh();
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <SidebarView
      me={me}
      activeKey={activeKeyFor(pathname)}
      wsOpen={wsOpen}
      onToggleWs={() => setWsOpen((v) => !v)}
      onSelectWorkspace={selectWorkspace}
      onSignOut={signOut}
    />
  );
}
