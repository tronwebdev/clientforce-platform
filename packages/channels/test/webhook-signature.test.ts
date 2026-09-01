/**
 * D1 (DEC-170): the SendGrid Signed Event Webhook verification had NO test.
 * That is how both of its defects survived — it never once ran against a real
 * signature. These sign with a real ECDSA P-256 key and prove:
 *
 *  1. the RAW body verifies and a re-serialized one does NOT (the defect that
 *     would have rejected every genuine event even with the key present); and
 *  2. the BARE base64 key SendGrid's console hands out works, not just PEM
 *     (the defect that would have thrown on the value an owner actually
 *     pastes into Key Vault).
 */
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeSendGridPublicKey,
  sendGridWebhookKeyState,
  verifySendGridSignature,
} from "../src/webhooks";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
/** Exactly what SendGrid's console shows: base64 SPKI/DER, no armour. */
const BARE = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const TIMESTAMP = "1780000000";
const sign = (payload: string, timestamp = TIMESTAMP): string => {
  const signer = createSign("sha256");
  signer.update(timestamp + payload);
  return signer.sign(privateKey, "base64");
};

/**
 * A body shaped like SendGrid's: compact separators and a trailing newline.
 * `JSON.stringify(JSON.parse(raw))` does NOT reproduce it — which is the point.
 */
const RAW_BODY =
  '[{"email":"lead@example.test","event":"bounce","type":"bounce","status":"5.1.1","sg_event_id":"evt-1","timestamp":1780000000}]\n';

describe("verifySendGridSignature — the raw-body contract (DEC-170)", () => {
  it("verifies the RAW body byte-for-byte", () => {
    expect(verifySendGridSignature(PEM, RAW_BODY, sign(RAW_BODY), TIMESTAMP)).toBe(true);
  });

  it("REJECTS a re-serialized body — the defect this unit fixes", () => {
    // The controller used to hand `JSON.stringify(parsedBody)` here. Same data,
    // different bytes (no trailing newline), so a valid signature fails.
    const reserialized = JSON.stringify(JSON.parse(RAW_BODY));
    expect(reserialized).not.toBe(RAW_BODY);
    expect(verifySendGridSignature(PEM, reserialized, sign(RAW_BODY), TIMESTAMP)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const signature = sign(RAW_BODY);
    const tampered = RAW_BODY.replace("5.1.1", "4.2.2");
    expect(verifySendGridSignature(PEM, tampered, signature, TIMESTAMP)).toBe(false);
  });

  it("rejects a replayed signature under a different timestamp", () => {
    expect(verifySendGridSignature(PEM, RAW_BODY, sign(RAW_BODY), "1780000001")).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const signer = createSign("sha256");
    signer.update(TIMESTAMP + RAW_BODY);
    const foreign = signer.sign(other.privateKey, "base64");
    expect(verifySendGridSignature(PEM, RAW_BODY, foreign, TIMESTAMP)).toBe(false);
  });
});

describe("normalizeSendGridPublicKey — the key an owner actually pastes (DEC-170)", () => {
  it("accepts the BARE base64 key from SendGrid's console", () => {
    expect(verifySendGridSignature(BARE, RAW_BODY, sign(RAW_BODY), TIMESTAMP)).toBe(true);
  });

  it("accepts a bare key that a copy-paste wrapped in whitespace", () => {
    const wrapped = `  ${BARE.slice(0, 40)}\n${BARE.slice(40)}  `;
    expect(verifySendGridSignature(wrapped, RAW_BODY, sign(RAW_BODY), TIMESTAMP)).toBe(true);
  });

  it("passes an existing PEM through untouched", () => {
    expect(normalizeSendGridPublicKey(PEM)).toBe(PEM.trim());
  });

  it("bare and PEM forms normalize to the same key material", () => {
    const fromBare = normalizeSendGridPublicKey(BARE).replace(/\s/g, "");
    expect(fromBare).toBe(PEM.replace(/\s/g, ""));
  });
});

describe("verifySendGridSignature — malformed input is a 401, never a 500", () => {
  it("returns false (does not throw) for a junk key", () => {
    expect(verifySendGridSignature("not-a-key", RAW_BODY, sign(RAW_BODY), TIMESTAMP)).toBe(false);
  });

  it("returns false (does not throw) for a junk signature", () => {
    expect(verifySendGridSignature(PEM, RAW_BODY, "%%%not-base64%%%", TIMESTAMP)).toBe(false);
  });

  it("returns false for an empty key", () => {
    expect(verifySendGridSignature("", RAW_BODY, sign(RAW_BODY), TIMESTAMP)).toBe(false);
  });
});

describe("sendGridWebhookKeyState — honest absence (DEC-170)", () => {
  it("reports absent with no key configured — the staging posture today", () => {
    expect(sendGridWebhookKeyState({})).toBe("absent");
    expect(sendGridWebhookKeyState({ SENDGRID_WEBHOOK_PUBLIC_KEY: "   " })).toBe("absent");
  });

  it("reports present once the owner adds it", () => {
    expect(sendGridWebhookKeyState({ SENDGRID_WEBHOOK_PUBLIC_KEY: BARE })).toBe("present");
  });
});
