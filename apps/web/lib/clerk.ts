/**
 * A3 (DEC-060): Clerk is wired ONLY when the publishable key is configured —
 * dev, CI and the e2e suites run with zero Clerk env and keep today's
 * dev-token auth byte-identically. The flag is inlined at build time on the
 * client (NEXT_PUBLIC_*) and read from process.env on the server.
 */
export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
