import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { fetchStaff } from "../../../lib/backoffice";

/**
 * The authed backoffice shell (B1 W1, DEC-079). A route-group layout so the
 * sign-in page (a sibling of this group) never inherits the auth redirect. The
 * middleware already gates `/backoffice/*` on the staff cookie; this also
 * resolves the operator identity and redirects if the token is missing/expired.
 */
export default async function BackofficeConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await fetchStaff();
  if (!staff) redirect("/backoffice/login");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--cf-color-bg, #fbf7f0)", fontFamily: "'Hanken Grotesk'" }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: "1px solid var(--cf-color-hairline, #ebe3d6)",
          background: "#fff",
          padding: "22px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, padding: "0 6px" }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--cf-gradient-brand, #35e834)",
              color: "#0e1512",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            f
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>Backoffice</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavLink href="/backoffice/tenants" label="Tenants" />
          <NavLink href="/backoffice/usage" label="Usage" />
          <NavLink href="/backoffice/reconciliation" label="Reconciliation" />
          <NavLink href="/backoffice/pricing" label="Credit pricing" />
          <NavLink href="/backoffice/audit" label="Audit log" />
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
          <div style={{ fontSize: 12, color: "#5b6560", padding: "0 6px 8px" }}>
            <div style={{ fontWeight: 600, color: "#0e1512" }}>{staff.name ?? staff.email}</div>
            <div>{staff.email}</div>
            <div style={{ marginTop: 2, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4 }}>
              {staff.role}
            </div>
          </div>
          <form action="/api/staff-auth/logout" method="post">
            <button
              type="submit"
              style={{
                width: "100%",
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--cf-color-hairline, #ebe3d6)",
                background: "transparent",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, padding: "28px 32px 40px" }}>{children}</main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "9px 10px",
        borderRadius: 9,
        fontSize: 14,
        color: "#0e1512",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
