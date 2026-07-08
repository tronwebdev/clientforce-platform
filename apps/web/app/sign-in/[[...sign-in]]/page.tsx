import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { clerkEnabled } from "../../../lib/clerk";
import { clerkAppearance } from "../../../lib/clerk-appearance";

/**
 * A3 (DEC-060): Clerk sign-in skinned to checkpoints §7 — #FBF7F0 canvas,
 * on-system card anatomy, Bricolage heading, gradient primary. Without Clerk
 * configured this route hands over to the dev /login (CI/e2e unchanged).
 */
export default function SignInPage() {
  if (!clerkEnabled) redirect("/login");
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FBF7F0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        padding: 24,
      }}
      data-testid="sign-in-page"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#0A0F0C",
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          f
        </span>
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800,
            fontSize: 22,
            color: "#0E1512",
          }}
        >
          Clientforce
        </span>
      </div>
      <SignIn appearance={clerkAppearance} />
    </main>
  );
}
