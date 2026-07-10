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
  const [profileOpen, setProfileOpen] = useState(false);

  // Single-open + close on outside click (sidebar.js behavior).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".cf-sb")) {
        setWsOpen(false);
        setToolsOpen(false);
        setHelpOpen(false);
        setProfileOpen(false);
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
        setProfileOpen(false);
      }
      return !v;
    });
  }

  function toggleTools() {
    setToolsOpen((v) => {
      if (!v) {
        setWsOpen(false);
        setHelpOpen(false);
        setProfileOpen(false);
      }
      return !v;
    });
  }

  function toggleHelp() {
    setHelpOpen((v) => {
      if (!v) {
        setWsOpen(false);
        setToolsOpen(false);
        setProfileOpen(false);
      }
      return !v;
    });
  }

  function toggleProfile() {
    setProfileOpen((v) => {
      if (!v) {
        setWsOpen(false);
        setToolsOpen(false);
        setHelpOpen(false);
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
    // A3 (DEC-060): in Clerk mode the Clerk session must end too, or the
    // middleware bounces the user straight back in. The provider exposes the
    // global; absent (dev mode) we fall through to the dev login.
    const clerk = (window as { Clerk?: { signOut?: (o?: { redirectUrl?: string }) => Promise<void> } }).Clerk;
    if (clerk?.signOut) {
      await clerk.signOut({ redirectUrl: "/sign-in" });
      return;
    }
    window.location.href = "/login";
  }

  return (
    <SidebarView
      me={me}
      activeKey={activeKeyFor(pathname)}
      wsOpen={wsOpen}
      toolsOpen={toolsOpen}
      helpOpen={helpOpen}
      profileOpen={profileOpen}
      onToggleWs={toggleWs}
      onToggleTools={toggleTools}
      onToggleHelp={toggleHelp}
      onToggleProfile={toggleProfile}
      onSelectWorkspace={selectWorkspace}
      onSignOut={signOut}
    />
  );
}
