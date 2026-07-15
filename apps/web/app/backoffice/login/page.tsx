import { Button } from "@clientforce/ui";

/**
 * Platform-staff sign-in (B1 W1, DEC-079). Its own page, outside the authed
 * console layout, on its own cookie rail — a tenant login never lands here.
 */
export default async function BackofficeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const message =
    sp.error === "denied"
      ? "That email is not an active platform operator."
      : sp.error === "email"
        ? "Enter a valid email address."
        : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--cf-color-bg)",
        fontFamily: "var(--cf-font-body, 'Hanken Grotesk')",
      }}
    >
      <form
        action="/api/staff-auth/login"
        method="post"
        style={{
          width: 380,
          maxWidth: "90vw",
          background: "#fff",
          border: "1px solid var(--cf-color-hairline, #ebe3d6)",
          borderRadius: 18,
          padding: "32px 28px",
          boxShadow: "0 12px 40px rgba(14,21,18,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--cf-gradient-brand, #35e834)",
              color: "#0e1512",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
            }}
          >
            f
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Clientforce · Backoffice</span>
        </div>
        <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 26, fontWeight: 700, margin: 0 }}>
          Operator sign in
        </h1>
        <p style={{ color: "#5b6560", fontSize: 13, margin: 0 }}>
          Internal platform staff only. Enter your allow-listed operator email.
        </p>
        <input
          name="email"
          type="email"
          required
          placeholder="ops@clientforce.io"
          aria-label="Operator email"
          style={{
            height: 42,
            borderRadius: 10,
            border: "1px solid var(--cf-color-hairline, #ebe3d6)",
            padding: "0 12px",
            fontSize: 14,
          }}
        />
        {message ? (
          <p style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13, margin: 0 }}>{message}</p>
        ) : null}
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
    </main>
  );
}
