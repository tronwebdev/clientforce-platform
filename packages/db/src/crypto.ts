import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field encryption for per-tenant credentials (P1.5, handoff credential rule):
 * platform secrets live in Key Vault; per-tenant secrets live encrypted in the
 * DB under the FIELD-ENCRYPTION-KEY master key (Key Vault → env) — never in
 * Key Vault, never plaintext.
 *
 * AES-256-GCM, per-value random IV. Layout: version(1) | iv(12) | tag(16) |
 * ciphertext — the version byte allows key rotation without a table rewrite.
 */
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function masterKey(explicit?: string): Buffer {
  const b64 = explicit ?? process.env.FIELD_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not set. In deployed environments it resolves from Key Vault secret FIELD-ENCRYPTION-KEY.",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
    );
  }
  return key;
}

export function encryptField(plaintext: string, keyB64?: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", masterKey(keyB64), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decryptField(data: Uint8Array, keyB64?: string): string {
  const buf = Buffer.from(data);
  if (buf.length < 1 + IV_LENGTH + TAG_LENGTH || buf[0] !== VERSION) {
    throw new Error(`Unsupported encrypted-field layout (version ${buf[0] ?? "none"})`);
  }
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(keyB64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
