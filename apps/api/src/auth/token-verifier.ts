/** Claims extracted from a verified bearer token. */
export interface AuthClaims {
  /** Stable subject id from the auth provider (maps to User.authProviderId). */
  sub: string;
  email?: string;
  name?: string;
  /** Active Clerk Organization id (maps to Workspace.clerkOrgId). */
  orgId?: string;
  /** Active Clerk Organization slug (informational; not used for linking). */
  orgSlug?: string;
  /** Clerk org role (e.g. "org:admin") — used only to seed a new membership. */
  orgRole?: string;
}

/** Provider-agnostic token verification contract. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

/** DI token for the configured verifier. */
export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
