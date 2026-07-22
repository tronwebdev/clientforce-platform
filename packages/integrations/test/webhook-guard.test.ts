/**
 * INT W3 (DEC-095): the general outbound-URL guard — the adversarial table.
 * Every refusal is typed and NAMES its rule; every private/reserved v4+v6
 * form refuses; only public https on the allowlisted ports passes. Pure unit
 * (DNS is exercised only through literal IPs + a guaranteed-NXDOMAIN name).
 */
import { describe, expect, it } from "vitest";
import { IntegrationDeliveryError } from "../src/types";
import { assertPublicHttpsUrl, isPublicV4, isPublicV6 } from "../src/webhook-guard";

const refusal = async (url: string): Promise<string> => {
  try {
    await assertPublicHttpsUrl(url);
  } catch (err) {
    if (err instanceof IntegrationDeliveryError) return err.reason;
    throw err;
  }
  return "PASSED";
};

describe("webhook guard — scheme/shape rules", () => {
  it("refuses non-https schemes, naming the rule", async () => {
    expect(await refusal("http://example.com/hook")).toBe("webhook_url_not_https");
    expect(await refusal("ftp://example.com/hook")).toBe("webhook_url_not_https");
    expect(await refusal("file:///etc/passwd")).toBe("webhook_url_not_https");
  });

  it("refuses garbage and credentialed URLs", async () => {
    expect(await refusal("not a url")).toBe("webhook_url_invalid");
    expect(await refusal("https://user:pass@example.com/hook")).toBe("webhook_url_credentials");
  });

  it("allows only ports 443/8443", async () => {
    expect(await refusal("https://1.1.1.1:8080/hook")).toBe("webhook_port_not_allowed");
    expect(await refusal("https://1.1.1.1:80/hook")).toBe("webhook_port_not_allowed");
    expect(await refusal("https://1.1.1.1:22/hook")).toBe("webhook_port_not_allowed");
    expect(await refusal("https://1.1.1.1:8443/hook")).toBe("PASSED");
  });

  it("refuses an unresolvable host, naming the rule", async () => {
    expect(await refusal("https://definitely-not-a-real-host.invalid/hook")).toBe("webhook_host_unresolvable");
  });
});

describe("webhook guard — private/reserved address refusals (literal IPs)", () => {
  const blockedV4 = [
    "10.0.0.1", // RFC1918
    "10.255.255.255",
    "172.16.0.1", // RFC1918 172.16/12
    "172.31.255.254",
    "192.168.1.1", // RFC1918
    "127.0.0.1", // loopback
    "127.255.255.255",
    "169.254.169.254", // link-local — the cloud metadata endpoint
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "192.0.2.10", // TEST-NET-1
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "255.255.255.255", // broadcast
  ];
  for (const ip of blockedV4) {
    it(`refuses v4 ${ip}`, async () => {
      expect(await refusal(`https://${ip}/hook`)).toBe("webhook_host_not_public");
    });
  }

  it("passes public v4 literals", async () => {
    expect(await refusal("https://1.1.1.1/hook")).toBe("PASSED");
    expect(await refusal("https://8.8.8.8/hook")).toBe("PASSED");
    // 172.32.x is OUTSIDE 172.16/12 — the mask math must not over-block.
    expect(await refusal("https://172.32.0.1/hook")).toBe("PASSED");
    // 11.x borders 10/8; 192.169.x borders 192.168/16.
    expect(await refusal("https://11.0.0.1/hook")).toBe("PASSED");
    expect(await refusal("https://192.169.0.1/hook")).toBe("PASSED");
  });

  const blockedV6 = [
    "[::1]", // loopback
    "[::]", // unspecified
    "[fc00::1]", // ULA fc00::/7
    "[fd12:3456::1]", // ULA
    "[fe80::1]", // link-local
    "[fec0::1]", // deprecated site-local
    "[ff02::1]", // multicast
    "[::ffff:10.0.0.1]", // v4-mapped private
    "[::ffff:169.254.169.254]", // v4-mapped metadata
    "[64:ff9b::a00:1]", // NAT64 well-known prefix
    "[2001:db8::1]", // documentation
    // W3 review (ssrf #2): the transition/embedded forms the guard used to pass.
    "[::7f00:1]", // v4-compatible ::/96 == ::127.0.0.1
    "[2002:a9fe:a9fe::]", // 6to4 embedding 169.254.169.254 (metadata)
    "[2002:7f00:1::]", // 6to4 embedding 127.0.0.1 (loopback)
    "[2001:0:4136:e378:8000:63bf:3fff:fdd2]", // Teredo 2001:0000::/32
    "[2001::1]", // Teredo, compressed
    "[64:ff9b:1::1]", // RFC 8215 local-use NAT64 64:ff9b:1::/48
  ];
  for (const ip of blockedV6) {
    it(`refuses v6 ${ip}`, async () => {
      expect(await refusal(`https://${ip}/hook`)).toBe("webhook_host_not_public");
    });
  }

  it("passes public v6 literals and v4-mapped public", async () => {
    expect(await refusal("https://[2606:4700:4700::1111]/hook")).toBe("PASSED");
    expect(await refusal("https://[::ffff:1.1.1.1]/hook")).toBe("PASSED");
    // A 6to4 that embeds a PUBLIC v4 (8.8.8.8) resolves to that public target —
    // the embedded-v4-decides contract must NOT over-block it.
    expect(await refusal("https://[2002:808:808::]/hook")).toBe("PASSED");
  });
});

describe("webhook guard — range helpers", () => {
  it("isPublicV4 edges", () => {
    expect(isPublicV4("9.255.255.255")).toBe(true);
    expect(isPublicV4("10.0.0.0")).toBe(false);
    expect(isPublicV4("100.63.255.255")).toBe(true);
    expect(isPublicV4("100.64.0.0")).toBe(false);
    expect(isPublicV4("100.127.255.255")).toBe(false);
    expect(isPublicV4("100.128.0.0")).toBe(true);
  });
  it("isPublicV6 case-insensitivity", () => {
    expect(isPublicV6("FC00::1")).toBe(false);
    expect(isPublicV6("FE80::1")).toBe(false);
  });
  it("isPublicV6 transition/embedded ranges (ssrf #2)", () => {
    expect(isPublicV6("::7f00:1")).toBe(false); // v4-compatible loopback
    expect(isPublicV6("2002:a9fe:a9fe::")).toBe(false); // 6to4 metadata
    expect(isPublicV6("2001:0:4136::1")).toBe(false); // Teredo
    expect(isPublicV6("64:ff9b:1::1")).toBe(false); // NAT64 local-use
    expect(isPublicV6("2002:808:808::")).toBe(true); // 6to4 wrapping public 8.8.8.8
    expect(isPublicV6("2606:4700:4700::1111")).toBe(true); // ordinary global unicast
  });
});
