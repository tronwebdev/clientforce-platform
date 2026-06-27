import { describe, expect, it } from "vitest";
import { asId, CORE_PACKAGE } from "../src/index";

describe("@clientforce/core", () => {
  it("exposes the package marker", () => {
    expect(CORE_PACKAGE).toBe("@clientforce/core");
  });

  it("brands a string as an Id without altering its value", () => {
    expect(asId("abc123")).toBe("abc123");
  });
});
