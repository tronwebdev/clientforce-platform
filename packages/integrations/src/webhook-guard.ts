/**
 * The general outbound-URL guard (INT W3, DEC-095) — the SSRF rail the W2
 * review deferred to this wave. `send_webhook` POSTs a user-configured URL
 * from inside the platform's network, so the destination is constrained to
 * what the field MEANS: a public https endpoint the owner operates.
 *
 * Rules (each refusal is typed and NAMES the rule):
 *   https only · hostname must DNS-resolve · every resolved address must be
 *   public (private/loopback/link-local/CGNAT/reserved v4+v6 ranges refuse) ·
 *   port ∈ {443, 8443} · redirects are not followed (3xx = refusal at
 *   delivery time) · 5s timeout + a small response cap at the transport.
 *
 * Known-and-stated v1 residual: DNS TOCTOU — the name is resolved for the
 * check and again by fetch; a rebinding name can differ between the two.
 * Accepted for v1 (the guard still kills every static-name attack); the
 * pinned-dispatcher follow-up is logged in the DEC.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { IntegrationDeliveryError } from "./types";
import { WEBHOOK_ALLOWED_PORTS } from "./constants";

/** Private/reserved IPv4 ranges as [base, maskBits]. */
const V4_BLOCKED: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 3], // multicast + reserved + broadcast (224/3 covers through 255.255.255.255)
];

const v4ToInt = (ip: string): number =>
  ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);

const inV4Block = (ip: string, [base, bits]: [string, number]): boolean => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

export function isPublicV4(ip: string): boolean {
  return !V4_BLOCKED.some((block) => inV4Block(ip, block));
}

export function isPublicV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // v4-mapped (::ffff:a.b.c.d) defers to the v4 rules.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicV4(mapped[1]!);
  if (lower === "::" || lower === "::1") return false; // unspecified + loopback
  // fc00::/7 (ULA) · fe80::/10 (link-local) · fec0::/10 (deprecated site-local) · ff00::/8 (multicast)
  if (/^f[cd]/.test(lower)) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (/^fe[cdef]/.test(lower)) return false;
  if (/^ff/.test(lower)) return false;
  // 64:ff9b::/96 (NAT64 well-known prefix) — the embedded v4 decides.
  if (lower.startsWith("64:ff9b::")) return false;
  // 2001:db8::/32 documentation range.
  if (lower.startsWith("2001:db8")) return false;
  return true;
}

export interface GuardedUrl {
  url: URL;
  /** Every address the name resolved to (all validated public). */
  addresses: string[];
}

/**
 * Validate an outbound webhook destination. Throws a typed
 * `IntegrationDeliveryError` naming the violated rule; returns the parsed
 * URL + the resolved addresses on success.
 */
export async function assertPublicHttpsUrl(rawUrl: string): Promise<GuardedUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new IntegrationDeliveryError("webhook_url_invalid", "the destination is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new IntegrationDeliveryError("webhook_url_not_https", "webhooks POST to https endpoints only");
  }
  if (url.username || url.password) {
    throw new IntegrationDeliveryError("webhook_url_credentials", "credentials in the URL are not allowed");
  }
  const port = url.port ? Number(url.port) : 443;
  if (!(WEBHOOK_ALLOWED_PORTS as readonly number[]).includes(port)) {
    throw new IntegrationDeliveryError(
      "webhook_port_not_allowed",
      `port ${port} is not allowed — webhooks deliver to ports ${WEBHOOK_ALLOWED_PORTS.join("/")}`,
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // bare v6 form
  let addresses: string[];
  const literal = isIP(host);
  if (literal) {
    addresses = [host];
  } else {
    try {
      const results = await lookup(host, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new IntegrationDeliveryError("webhook_host_unresolvable", `the destination host ${host} does not resolve`);
    }
    if (addresses.length === 0) {
      throw new IntegrationDeliveryError("webhook_host_unresolvable", `the destination host ${host} does not resolve`);
    }
  }
  for (const addr of addresses) {
    const family = isIP(addr);
    const ok = family === 4 ? isPublicV4(addr) : family === 6 ? isPublicV6(addr) : false;
    if (!ok) {
      throw new IntegrationDeliveryError(
        "webhook_host_not_public",
        `the destination resolves to a non-public address — webhooks deliver to public endpoints only`,
      );
    }
  }
  return { url, addresses };
}
