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
  contact: Pick<Contact, "firstName" | "lastName" | "company" | "email">,
  senderName: string,
): string {
  const values: Record<string, string | null | undefined> = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    email: contact.email,
    senderName,
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, token: string) => {
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
