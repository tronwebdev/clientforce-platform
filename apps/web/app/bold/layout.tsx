import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CONSOLE_BOLD_FLAG } from "@clientforce/core";
import { FirstRunWorkspace } from "../../components/FirstRunWorkspace";
import { fetchMe, fetchWorkspaceFlags } from "../../lib/api";
import { clerkEnabled } from "../../lib/clerk";

// Console Bold fonts (§Bold type scale) — self-hosted per the repo's
// @fontsource precedent. Loading here keeps them off the legacy bundle; the
// families are referenced only by --cvb-* tokens, so legacy screens never
// pick them up even though the @font-face rules are global once /bold loads.
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/schibsted-grotesk/800.css";
import "@fontsource/schibsted-grotesk/900.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
// The additive Bold token layer (--cvb-*) + the shell chrome that consumes it.
import "@clientforce/theme/console-bold.css";
import "./bold.css";

/**
 * Console Bold parallel route (B0) — mounts ONLY when the active workspace
 * carries the `consoleBold` FeatureFlag (backoffice-flipped, default off).
 * Flag off or unreadable → the legacy console, untouched. Launch is a flag
 * flip per workspace; rollback is the flag going off (MIGRATION_NON_BREAKING).
 */
export default async function BoldLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  if (!me) redirect(clerkEnabled ? "/sign-in" : "/login");
  if ("noWorkspace" in me) return <FirstRunWorkspace />;
  const flags = await fetchWorkspaceFlags();
  if (!flags.includes(CONSOLE_BOLD_FLAG)) redirect("/");
  return <>{children}</>;
}
