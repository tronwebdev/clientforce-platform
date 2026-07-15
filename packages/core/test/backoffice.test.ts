/**
 * B1 W2 (DEC-080) — `resolveCreditPrice`: effective-dated price resolution with a
 * per-agency override beating the platform default. Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { resolveCreditPrice, type CreditPriceRow } from "../src/backoffice";

const t = (s: string) => new Date(s);

const rows: CreditPriceRow[] = [
  { agencyId: null, action: "email_send", credits: 1, effectiveFrom: t("2026-01-01") },
  { agencyId: null, action: "email_send", credits: 2, effectiveFrom: t("2026-06-01") }, // newer default
  { agencyId: "ag1", action: "email_send", credits: 5, effectiveFrom: t("2026-03-01") }, // override
  { agencyId: null, action: "sms_segment", credits: 5, effectiveFrom: t("2026-01-01") },
];

describe("resolveCreditPrice", () => {
  it("uses the newest platform default when the agency has no override", () => {
    expect(resolveCreditPrice(rows, { agencyId: "other", action: "email_send", at: t("2026-07-01") })).toBe(2);
  });

  it("an agency override beats the platform default", () => {
    expect(resolveCreditPrice(rows, { agencyId: "ag1", action: "email_send", at: t("2026-07-01") })).toBe(5);
  });

  it("respects effective dating — before the override, the default applies", () => {
    expect(resolveCreditPrice(rows, { agencyId: "ag1", action: "email_send", at: t("2026-02-01") })).toBe(1);
  });

  it("ignores rows not yet effective", () => {
    // At 2026-05-01 the credits=2 default (2026-06-01) is not yet effective.
    expect(resolveCreditPrice(rows, { agencyId: null, action: "email_send", at: t("2026-05-01") })).toBe(1);
  });

  it("returns null when no price applies", () => {
    expect(resolveCreditPrice(rows, { agencyId: "ag1", action: "voice_minute", at: t("2026-07-01") })).toBeNull();
  });
});
