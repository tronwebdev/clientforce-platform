import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "../../components/Sidebar";
import { fetchMe } from "../../lib/api";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  if (!me) redirect("/login");
  return (
    <div className="cf-shell-layout">
      <Sidebar me={me} />
      <div className="cf-main">{children}</div>
    </div>
  );
}
