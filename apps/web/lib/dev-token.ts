import { SignJWT } from "jose";
import { AUTH_DEV_SECRET, DEV_AUDIENCE, DEV_ISSUER } from "./config";

/**
 * Mint a dev session token for the given email (dev sign-in only). Shape matches
 * the API's DevTokenVerifier (HS256, iss/aud). Production replaces this with a
 * Clerk-issued session — the shell only ever sees an opaque bearer token.
 */
export async function signDevToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`dev|${email}`)
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(AUTH_DEV_SECRET));
}
