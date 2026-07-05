"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { activeKeyFor } from "./nav";
import { SidebarView } from "./SidebarView";
import type { Me } from "../lib/types";

/** Client wrapper: pathname-derived active state + switch/sign-out + flyout wiring. */
export function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const router = useRouter();
  const [wsOpen, setWsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Single-open + close on outside click (sidebar.js behavior).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".cf-sb")) {
        setWsOpen(false);
        setToolsOpen(false);
        setHelpOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function toggleWs() {
    setWsOpen((v) => {
      if (!v) {
        setToolsOpen(false);
        setHelpOpen(false);
      }
      return !v;
    });
  }

  function toggleTools() {
    setToolsOpen((v) => {
      if (!v) {
        setWsOpen(false);
        setHelpOpen(false);
      }
      return !v;
    });
  }

  function toggleHelp() {
    setHelpOpen((v) => {
      if (!v) {
        setWsOpen(false);
        setToolsOpen(false);
      }
      return !v;
    });
  }

  async function selectWorkspace(workspaceId: string) {
    setWsOpen(false);
    if (workspaceId === me.activeWorkspace?.id) return;
    await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
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
      toolsOpen={toolsOpen}
      helpOpen={helpOpen}
      onToggleWs={toggleWs}
      onToggleTools={toggleTools}
      onToggleHelp={toggleHelp}
      onSelectWorkspace={selectWorkspace}
      onSignOut={signOut}
    />
  );
}
