import { jwtVerify, SignJWT } from "jose";

/**
 * Platform-staff tokens (B1 W1, DEC-079). Deliberately a SEPARATE credential
 * rail from tenant auth: a distinct issuer/audience (`clientforce-backoffice`)
 * means a tenant dev-JWT — audience `clientforce`, issuer `clientforce-dev` —
 * can never verify here, so a tenant credential can never open the backoffice
 * even before the PlatformStaff allow-list check runs.
 *
 * HS256 dev-rail (mirrors the tenant `DevTokenVerifier`); production swaps this
 * for platform SSO. The secret is `BACKOFFICE_AUTH_SECRET`, falling back to
 * `AUTH_DEV_SECRET` so CI/local need no extra wiring.
 */
export const STAFF_ISSUER = "clientforce-backoffice";
export const STAFF_AUDIENCE = "clientforce-backoffice";

export type StaffRole = "OPERATOR" | "ADMIN";

export interface StaffClaims {
  /** PlatformStaff id. */
  sub: string;
  email: string;
  name?: string;
  role: StaffRole;
}

function staffSecret(): Uint8Array {
  const secret = process.env.BACKOFFICE_AUTH_SECRET ?? process.env.AUTH_DEV_SECRET;
  if (!secret) {
    throw new Error(
      "Backoffice auth not configured: set BACKOFFICE_AUTH_SECRET (or AUTH_DEV_SECRET for dev/CI).",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signStaffToken(claims: StaffClaims, expiresIn = "8h"): Promise<string> {
  return new SignJWT({
    email: claims.email,
    ...(claims.name ? { name: claims.name } : {}),
    role: claims.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(STAFF_ISSUER)
    .setAudience(STAFF_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(staffSecret());
}

export async function verifyStaffToken(token: string): Promise<StaffClaims> {
  const { payload } = await jwtVerify(token, staffSecret(), {
    issuer: STAFF_ISSUER,
    audience: STAFF_AUDIENCE,
  });
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!payload.sub || !email) throw new Error("Malformed staff token");
  const role: StaffRole = payload.role === "ADMIN" ? "ADMIN" : "OPERATOR";
  return {
    sub: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    role,
  };
}
