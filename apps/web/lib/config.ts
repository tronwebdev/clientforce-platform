/** Shell configuration (server-side). */
export const API_URL = process.env.API_URL ?? "http://localhost:3001";

/** Dev-verifier secret — must match the API's AUTH_DEV_SECRET. */
export const AUTH_DEV_SECRET = process.env.AUTH_DEV_SECRET ?? "dev-secret";

/** Matches the API DevTokenVerifier's expected issuer/audience. */
export const DEV_ISSUER = "clientforce-dev";
export const DEV_AUDIENCE = "clientforce";

export const SESSION_COOKIE = "cf_session";
export const WORKSPACE_COOKIE = "cf_workspace";

// B1 W1 (DEC-079): the platform backoffice runs on a SEPARATE session cookie —
// a tenant `cf_session` never opens the operator surface and vice-versa.
export const STAFF_SESSION_COOKIE = "cf_staff_session";
