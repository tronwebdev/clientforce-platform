// Self-hosted brand fonts (DESIGN_TOKENS.md §2) — display weights 600/700/800,
// body weights 400/500/600/700.
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
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
