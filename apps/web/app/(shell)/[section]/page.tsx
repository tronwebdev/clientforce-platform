import { redirect } from "next/navigation";
import { Card } from "@clientforce/ui";
import { TopBar } from "../../../components/TopBar";
import { fetchMe } from "../../../lib/api";
import type { Role } from "../../../lib/types";

const TITLES: Record<string, string> = {
  help: "Help",
  stats: "Stats",
  integrations: "Integrations",
  settings: "Settings",
  "lead-finder": "Lead Finder",
  proposals: "Proposals",
  forms: "Forms",
  widget: "Agent Widget",
  linkedin: "LinkedIn Extension",
};

/** Routes that require an elevated role (auth + role guard demo). */
const ROLE_GATED: Record<string, Role[]> = {
  settings: ["OWNER", "ADMIN"],
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const me = await fetchMe();
  if (!me) redirect("/login");
  // A3 (DEC-060): membership-less principal — the shell layout renders the
  // first-run modal; the page contributes nothing.
  if ("noWorkspace" in me) return null;

  const { section } = await params;
  const title = TITLES[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
  const allowed = ROLE_GATED[section];
  const forbidden = allowed ? !allowed.includes(me.role) : false;

  return (
    <>
      <TopBar title={title} me={me} />
      <div className="cf-content">
        <Card>
          {forbidden ? (
            <>
              <h2 style={{ marginTop: 0, fontSize: "var(--cf-text-18)", color: "var(--cf-color-danger)" }}>
                Insufficient permissions
              </h2>
              <p style={{ color: "var(--cf-color-muted-2)" }}>
                {title} requires {allowed?.join(" or ")}. You are signed in as {me.role}.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0, fontSize: "var(--cf-text-18)" }}>{title}</h2>
              <p style={{ color: "var(--cf-color-muted-2)" }}>
                {title} lands in a later ticket. The shell, tenancy, and design system are in place.
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
