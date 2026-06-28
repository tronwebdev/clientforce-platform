/** Claims extracted from a verified bearer token. */
export interface AuthClaims {
  /** Stable subject id from the auth provider (maps to User.authProviderId). */
  sub: string;
  email?: string;
  name?: string;
}

/** Provider-agnostic token verification contract. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

/** DI token for the configured verifier. */
export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
