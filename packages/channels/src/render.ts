import { CUSTOM_TOKEN_RE } from "@clientforce/core";
import type { Contact } from "@clientforce/db";

/**
 * Send-time token rendering. Same house rule as the prompt registry: a
 * referenced-but-missing token FAILS the send — silent empty interpolation is
 * how bad sends happen.
 */
export class MissingTokenError extends Error {
  constructor(readonly token: string) {
    super(`Merge token {{${token}}} has no value for this recipient`);
    this.name = "MissingTokenError";
  }
}

export function renderTokens(
  text: string,
  contact: Pick<Contact, "firstName" | "lastName" | "company" | "email"> &
    Partial<Pick<Contact, "custom">>,
  senderName: string,
): string {
  // C2.7 custom tokens first: {{custom.<key>|fallback}} → value-or-fallback.
  // No value AND no fallback throws — custom tokens never render blank; the
  // wizard rejects fallback-less tokens at save time, this is the boundary
  // backstop.
  const custom =
    contact.custom && typeof contact.custom === "object" && !Array.isArray(contact.custom)
      ? (contact.custom as Record<string, unknown>)
      : {};
  const withCustom = text.replace(CUSTOM_TOKEN_RE, (_m, key: string, fallback?: string) => {
    const value = custom[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    const fb = fallback?.trim();
    if (fb) return fb;
    throw new MissingTokenError(`custom.${key}`);
  });

  const values: Record<string, string | null | undefined> = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    email: contact.email,
    senderName,
  };
  return withCustom.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, token: string) => {
    const value = values[token];
    if (value === undefined || value === null || value === "") throw new MissingTokenError(token);
    return value;
  });
}

const THREAD_PREFIX = /^\s*((re|fwd?)\s*:\s*)+/i;

/** Owner rule 3: a "Re:"/"Fwd:" prefix is only legal on a real thread. */
export const hasThreadPrefix = (subject: string): boolean => THREAD_PREFIX.test(subject);
export const stripThreadPrefix = (subject: string): string =>
  subject.replace(THREAD_PREFIX, "").trimStart();
export const withReplyPrefix = (subject: string): string =>
  hasThreadPrefix(subject) ? subject : `Re: ${subject}`;
