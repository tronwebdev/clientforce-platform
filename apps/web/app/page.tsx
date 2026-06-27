import { BRAND_COLOR } from "@clientforce/ui";

export default function HomePage() {
  return (
    <main className="cf-shell">
      <h1 className="cf-shell__title">Clientforce</h1>
      <p>Monorepo bootstrap (T0). The skeleton the Phase-1 vertical slice plugs into.</p>
      <p className="cf-shell__muted">Brand token: {BRAND_COLOR}</p>
    </main>
  );
}
