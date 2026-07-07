import { describe, expect, it } from "vitest";
import {
  customTokensMissingFallback,
  parseCustomTokens,
  slugifyFieldLabel,
  updateContactFieldSchema,
} from "../src/contact-fields";

describe("slugifyFieldLabel", () => {
  it("slugs labels to immutable keys", () => {
    expect(slugifyFieldLabel("Source URL ")).toBe("source_url");
    expect(slugifyFieldLabel("Plan")).toBe("plan");
    expect(slugifyFieldLabel("  Deal $$ Size!! ")).toBe("deal_size");
    expect(slugifyFieldLabel("???")).toBe("");
  });
});

describe("custom token grammar ({{custom.<key>|fallback}})", () => {
  it("parses keys and fallbacks", () => {
    expect(parseCustomTokens("Hi {{custom.industry|your industry}} and {{custom.plan}}")).toEqual([
      { key: "industry", fallback: "your industry" },
      { key: "plan", fallback: undefined },
    ]);
  });

  it("flags tokens missing the mandatory fallback (empty counts as missing)", () => {
    expect(customTokensMissingFallback("{{custom.plan}} {{custom.a|x}} {{custom.b|}}")).toEqual([
      "plan",
      "b",
    ]);
    expect(customTokensMissingFallback("no tokens {{firstName}}")).toEqual([]);
  });
});

describe("updateContactFieldSchema immutability", () => {
  it("rejects key/type edits outright (.strict)", () => {
    expect(updateContactFieldSchema.safeParse({ key: "x" }).success).toBe(false);
    expect(updateContactFieldSchema.safeParse({ type: "NUMBER", label: "L" }).success).toBe(false);
    expect(updateContactFieldSchema.safeParse({ label: "L" }).success).toBe(true);
    expect(updateContactFieldSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateContactFieldSchema.safeParse({}).success).toBe(false);
  });
});
