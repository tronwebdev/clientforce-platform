import { describe, expect, it } from "vitest";
import { BRAND_COLOR, colors, gradient, radius, shadow, space, text } from "../src/index";

describe("design tokens (canonical anchors)", () => {
  it("keeps the brand + contrast greens exact", () => {
    expect(colors.green).toBe("#35e834");
    expect(BRAND_COLOR).toBe("#35e834");
    expect(colors["green-ink"]).toBe("#16a82a"); // legible green on white
    expect(colors["green-700"]).toBe("#0f7a28"); // success-pill text
  });

  it("keeps the signature gradient", () => {
    expect(gradient.brand).toBe("linear-gradient(135deg,#36d7ed 0%,#35e834 55%,#d0f56b 100%)");
  });

  it("carries the canonical scales", () => {
    expect(radius).toMatchObject({ sm: 8, md: 11, lg: 14, xl: 16, "2xl": 20, pill: 100 });
    expect(shadow.card).toBe("0 4px 16px rgba(14,21,18,.04)");
    expect(space).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48]);
    expect(text).toEqual([11, 12, 13, 14, 16, 18, 20, 24, 28]);
  });

  it("exposes exactly the 19 named colors from §1", () => {
    expect(Object.keys(colors)).toHaveLength(19);
  });
});
