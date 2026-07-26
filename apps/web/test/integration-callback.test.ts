/**
 * INT W1-UI: the OAuth callback route's pure decision logic
 * (`lib/integration-callback.ts`) — state→redirect mapping, provider
 * validation, and the 200-char error truncation the redirect query carries.
 */
import { describe, expect, it } from "vitest";
import { INTEGRATION_PROVIDERS } from "@clientforce/core";
import {
  DETAIL_MAX,
  apiErrorDetail,
  decideCallback,
  resultQuery,
  truncateDetail,
} from "../lib/integration-callback";

describe("decideCallback (vendor query → outcome)", () => {
  it("code + state on a live provider → forward to complete", () => {
    expect(decideCallback("slack", { code: "c123", state: "s456", error: null })).toEqual({
      kind: "complete",
      provider: "slack",
      code: "c123",
      state: "s456",
    });
  });

  it("a vendor error wins and rides verbatim — even when code/state are present", () => {
    const d = decideCallback("slack", { code: "c", state: "s", error: "access_denied" });
    expect(d).toEqual({ kind: "error", detail: "access_denied" });
  });

  it("missing code or state → the honest cancelled/failed detail", () => {
    for (const params of [
      { code: null, state: "s", error: null },
      { code: "c", state: null, error: null },
    ]) {
      const d = decideCallback("slack", params);
      expect(d.kind).toBe("error");
      if (d.kind === "error") expect(d.detail).toContain("did not return an authorization code");
    }
  });

  it("an unknown provider never reaches the API — typed error, and every core provider passes", () => {
    const d = decideCallback("salesforce", { code: "c", state: "s", error: null });
    expect(d.kind).toBe("error");
    if (d.kind === "error") expect(d.detail).toContain("Unknown integration provider");
    for (const p of INTEGRATION_PROVIDERS) {
      expect(decideCallback(p, { code: "c", state: "s", error: null }).kind).toBe("complete");
    }
  });
});

describe("resultQuery (outcome → /integrations redirect query)", () => {
  it("connected → connected=<provider>", () => {
    expect(resultQuery({ kind: "connected", provider: "slack" })).toBe("connected=slack");
  });

  it("error → error=<detail URL-encoded>", () => {
    expect(resultQuery({ kind: "error", detail: "boom & bust" })).toBe(
      `error=${encodeURIComponent("boom & bust")}`,
    );
  });

  it("error detail is truncated to 200 chars before encoding", () => {
    const long = "x".repeat(500);
    const q = resultQuery({ kind: "error", detail: long });
    const decoded = decodeURIComponent(q.slice("error=".length));
    expect(decoded).toHaveLength(DETAIL_MAX);
    expect(decoded.endsWith("…")).toBe(true);
  });
});

describe("apiErrorDetail (non-OK API body → redirect detail)", () => {
  it("a string detail wins — even when a message is present", () => {
    expect(apiErrorDetail({ detail: "state mismatch — restart the connect flow", message: "Conflict" }, 409)).toBe(
      "state mismatch — restart the connect flow",
    );
  });

  it("falls back to a string message when detail is absent or non-string", () => {
    expect(apiErrorDetail({ message: "Unauthorized" }, 401)).toBe("Unauthorized");
    expect(apiErrorDetail({ detail: 42, message: "Bad Request" }, 400)).toBe("Bad Request");
  });

  it("null / non-object / non-string-field bodies → the honest status fallback", () => {
    expect(apiErrorDetail(null, 502)).toBe("Connect failed (502)");
    expect(apiErrorDetail(undefined, 500)).toBe("Connect failed (500)");
    expect(apiErrorDetail("boom", 500)).toBe("Connect failed (500)");
    expect(apiErrorDetail({ detail: 42, message: ["x"] }, 422)).toBe("Connect failed (422)");
  });
});

describe("truncateDetail", () => {
  it("short strings pass through untouched", () => {
    expect(truncateDetail("ok")).toBe("ok");
    expect(truncateDetail("x".repeat(DETAIL_MAX))).toBe("x".repeat(DETAIL_MAX));
  });

  it("long strings cap at the max with an ellipsis", () => {
    const out = truncateDetail("x".repeat(DETAIL_MAX + 1));
    expect(out).toHaveLength(DETAIL_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});
