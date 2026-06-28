import { redirect } from "next/navigation";
import { Card } from "@clientforce/ui";
import { TopBar } from "../../components/TopBar";
import { fetchMe } from "../../lib/api";

export default async function DashboardPage() {
  const me = await fetchMe();
  if (!me) redirect("/login");
  return (
    <>
      <TopBar title="Dashboard" me={me} />
      <div className="cf-content">
        <Card>
          <h2 style={{ marginTop: 0, fontSize: "var(--cf-text-20)" }}>
            Welcome back, {me.user.name ?? me.user.email}
          </h2>
          <p style={{ color: "var(--cf-color-muted-2)" }}>
            You&apos;re in <strong>{me.activeWorkspace?.name ?? "no workspace"}</strong> as {me.role}.
            Use the workspace switcher to change tenant context, or open Contacts to see RLS-scoped data.
          </p>
        </Card>
      </div>
    </>
  );
}
