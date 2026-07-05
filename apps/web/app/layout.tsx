// Self-hosted brand fonts (DESIGN_TOKENS.md §2). Display = the VARIABLE
// Bricolage cut (wght + opsz axes) — the prototypes load the variable font,
// and the static 700 instance renders visibly heavier at display sizes
// (owner review, PR #34). Aliased to the "Bricolage Grotesque" family in
// globals.css so every existing token/inline style picks it up.
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@clientforce/ui/tokens.css";
import "@clientforce/ui/styles.css";
import "./globals.css";
import "./shell.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Clientforce",
  description: "Clientforce AI agent platform — app shell.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
