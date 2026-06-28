import { Logger, type Provider } from "@nestjs/common";
import { DevTokenVerifier } from "./dev-token-verifier";
import { OidcTokenVerifier } from "./oidc-token-verifier";
import { TOKEN_VERIFIER, type AuthClaims, type TokenVerifier } from "./token-verifier";

/** Verifier used when neither OIDC nor a dev secret is configured. */
class UnconfiguredVerifier implements TokenVerifier {
  verify(_token: string): Promise<AuthClaims> {
    return Promise.reject(
      new Error(
        "Auth is not configured. Set AUTH_JWKS_URL (+ AUTH_ISSUER/AUTH_AUDIENCE) for OIDC, or AUTH_DEV_SECRET for dev/test.",
      ),
    );
  }
}

/**
 * Select the verifier from env: OIDC/JWKS in production, the HS256 dev verifier
 * for local/CI, otherwise a verifier that fails closed.
 */
export const tokenVerifierProvider: Provider = {
  provide: TOKEN_VERIFIER,
  useFactory: (): TokenVerifier => {
    const logger = new Logger("Auth");
    if (process.env.AUTH_JWKS_URL) {
      logger.log("Using OIDC token verifier (JWKS).");
      return new OidcTokenVerifier({
        jwksUrl: process.env.AUTH_JWKS_URL,
        ...(process.env.AUTH_ISSUER ? { issuer: process.env.AUTH_ISSUER } : {}),
        ...(process.env.AUTH_AUDIENCE ? { audience: process.env.AUTH_AUDIENCE } : {}),
      });
    }
    if (process.env.AUTH_DEV_SECRET) {
      logger.warn("Using DEV token verifier (HS256). Do not use in production.");
      return new DevTokenVerifier(process.env.AUTH_DEV_SECRET);
    }
    logger.error("Auth not configured — protected routes will reject all tokens.");
    return new UnconfiguredVerifier();
  },
};
