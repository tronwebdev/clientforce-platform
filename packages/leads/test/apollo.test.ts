/**
 * B6 (DEC-131): the adapter's KEYLESS posture is a contract, not an accident —
 * `configured()` false, and every call refuses with the typed PROVIDER_AUTH
 * error NAMING the Key Vault secret, never fabricated rows.
 */
import { describe, expect, it } from "vitest";
import { ApolloProvider } from "../src/apollo";
import { LeadProviderError } from "../src/types";

describe("ApolloProvider — keyless posture", () => {
  it("reports unconfigured without a key and refuses with the typed error", async () => {
    const p = new ApolloProvider("");
    expect(p.configured()).toBe(false);
    await expect(p.searchPeople({}, 5)).rejects.toThrowError(LeadProviderError);
    await expect(p.searchPeople({}, 5)).rejects.toThrowError(/APOLLO-API-KEY/);
    await expect(p.reveal("x")).rejects.toMatchObject({ kind: "PROVIDER_AUTH" });
  });

  it("reports configured with a key (no network here — transport is the adapter's only job)", () => {
    expect(new ApolloProvider("k").configured()).toBe(true);
  });
});
