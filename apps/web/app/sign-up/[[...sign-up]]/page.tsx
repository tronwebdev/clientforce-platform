import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { clerkEnabled } from "../../../lib/clerk";
import { clerkAppearance } from "../../../lib/clerk-appearance";

/** A3 (DEC-060): Clerk sign-up, same §7 skin as sign-in. */
export default function SignUpPage() {
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
      data-testid="sign-up-page"
    >
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
      <SignUp appearance={clerkAppearance} />
    </main>
  );
}
