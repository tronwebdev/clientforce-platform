import { Button } from "@clientforce/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="cf-login">
      <form className="cf-login__card" action="/api/auth/dev-login" method="post">
        <div className="cf-login__brand">
          <span className="cf-sb__mark">f</span>
          <span className="cf-login__wordmark">Clientforce</span>
        </div>
        <h1 className="cf-login__title">Sign in</h1>
        <p className="cf-login__hint">Dev sign-in — enter a seeded user&apos;s email.</p>
        <input
          className="cf-login__input"
          name="email"
          type="email"
          required
          placeholder="owner@demo-agency.test"
          aria-label="Email"
        />
        {sp.error ? <p className="cf-login__error">Enter a valid email address.</p> : null}
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
    </main>
  );
}
