/**
 * P5 W1 (DEC-083): SPF/DKIM/DMARC verification — REAL lookups with honest
 * failure states, never cached-as-verified: every check REPLACES the persisted
 * status wholesale, so "verified" can only ever mean "verified by the check
 * that wrote `lastCheckedAt`". A lookup that cannot run (no provider key,
 * resolver error) writes `unchecked` with the reason — it never inherits a
 * previous pass and never counts as failed.
 *
 * CF_MANAGED senders verify through SendGrid domain authentication (the
 * live-send-proof gate's exact API + matching rules) — SendGrid owns the
 * SPF/DKIM records for its send subdomain, so its per-record validity IS the
 * truth for those two. DMARC is always a direct `_dmarc.<root>` TXT lookup
 * (read-only; root-domain mail DNS is never touched, only observed). The
 * OAuth/SMTP tiers (designed-but-inert) get a direct SPF TXT lookup and an
 * honest `unchecked` DKIM (their selector isn't knowable from here). SMS
 * senders have no DNS posture — the checker returns null and writes nothing.
 *
 * Persisted into `SenderConnection.domainAuthStatus` keeping the shape the
 * Settings UI already reads (`{ spf: { pass, detail }, ... }`), extended
 * additively with status/lastCheckedAt/expected/found.
 */
import { Prisma, withTenant, type PrismaClient, type SenderConnection } from "@clientforce/db";

export type DnsRecordState = "verified" | "failed" | "unchecked";

export interface DnsRecordStatus {
  /** Legacy UI badge field — true ONLY when this check verified the record. */
  pass: boolean;
  status: DnsRecordState;
  detail: string;
  /** Copyable record the owner should publish (present on failures). */
  expected?: string;
  /** What the lookup actually found (present on verified/mismatch). */
  found?: string;
  lastCheckedAt: string;
}

export type DomainAuthStatus = Record<"spf" | "dkim" | "dmarc", DnsRecordStatus>;

export interface DnsCheckDeps {
  /** `node:dns/promises`-compatible resolver — injected so CI mocks it. */
  resolveTxt: (host: string) => Promise<string[][]>;
  /** SendGrid key for CF_MANAGED domain-auth verification (absent in CI). */
  sendgridApiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface SgDomain {
  domain: string;
  subdomain?: string;
  valid: boolean;
  dns?: Record<string, { valid: boolean; host: string; type: string; data?: string }>;
}

const senderDomain = (fromEmail: string): string | null => {
  const at = fromEmail.lastIndexOf("@");
  return at > 0 ? fromEmail.slice(at + 1).trim().toLowerCase() : null;
};

/** `send.example.com` → `example.com` (the proof script's root rule). */
const rootDomain = (domain: string): string => domain.split(".").slice(-2).join(".");

const record = (
  status: DnsRecordState,
  detail: string,
  at: Date,
  extra?: { expected?: string; found?: string },
): DnsRecordStatus => ({
  pass: status === "verified",
  status,
  detail,
  lastCheckedAt: at.toISOString(),
  ...(extra?.expected ? { expected: extra.expected } : {}),
  ...(extra?.found ? { found: extra.found } : {}),
});

async function checkDmarc(deps: DnsCheckDeps, domain: string, at: Date): Promise<DnsRecordStatus> {
  const host = `_dmarc.${rootDomain(domain)}`;
  const expected = `${host} TXT "v=DMARC1; p=none; rua=mailto:postmaster@${rootDomain(domain)}"`;
  try {
    const txt = (await deps.resolveTxt(host)).map((chunks) => chunks.join(""));
    const found = txt.find((t) => t.startsWith("v=DMARC1"));
    if (found) return record("verified", `Policy record present at ${host}`, at, { found });
    return record("failed", `No v=DMARC1 record at ${host}`, at, { expected });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return record("failed", `Not configured — no TXT record at ${host}`, at, { expected });
    }
    return record("unchecked", `Lookup failed (${code ?? "error"}) — could not verify`, at);
  }
}

async function checkDirectSpf(deps: DnsCheckDeps, domain: string, at: Date): Promise<DnsRecordStatus> {
  const expected = `${domain} TXT "v=spf1 ..."`;
  try {
    const txt = (await deps.resolveTxt(domain)).map((chunks) => chunks.join(""));
    const found = txt.find((t) => t.startsWith("v=spf1"));
    if (found) return record("verified", `SPF record present at ${domain}`, at, { found });
    return record("failed", `No v=spf1 record at ${domain}`, at, { expected });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return record("failed", `Not configured — no TXT record at ${domain}`, at, { expected });
    }
    return record("unchecked", `Lookup failed (${code ?? "error"}) — could not verify`, at);
  }
}

async function checkSendGridAuth(
  deps: DnsCheckDeps,
  domain: string,
  at: Date,
): Promise<{ spf: DnsRecordStatus; dkim: DnsRecordStatus }> {
  if (!deps.sendgridApiKey) {
    const detail = "Provider verification unavailable — no SendGrid key configured";
    return { spf: record("unchecked", detail, at), dkim: record("unchecked", detail, at) };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  let domains: SgDomain[];
  try {
    const res = await fetchImpl("https://api.sendgrid.com/v3/whitelabel/domains", {
      headers: { Authorization: `Bearer ${deps.sendgridApiKey}` },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    domains = (await res.json()) as SgDomain[];
  } catch (err) {
    const detail = `Provider lookup failed (${(err as Error).message}) — could not verify`;
    return { spf: record("unchecked", detail, at), dkim: record("unchecked", detail, at) };
  }

  const match = domains.find((d) => d.domain === domain || `${d.subdomain}.${d.domain}` === domain);
  if (!match) {
    const detail = `Domain ${domain} is not authenticated in SendGrid`;
    return {
      spf: record("failed", detail, at),
      dkim: record("failed", detail, at),
    };
  }

  const entries = Object.entries(match.dns ?? {});
  const describe = ([key, r]: (typeof entries)[number]): string =>
    `${r.host} ${r.type.toUpperCase()}${r.data ? ` → ${r.data}` : ""} (${key})`;
  const dkimEntries = entries.filter(([key]) => key.toLowerCase().includes("dkim"));
  const spfEntries = entries.filter(([key]) => !key.toLowerCase().includes("dkim"));

  const summarize = (subset: typeof entries, label: string): DnsRecordStatus => {
    if (subset.length === 0) {
      return match.valid
        ? record("verified", `${label} verified by SendGrid for ${domain}`, at)
        : record("failed", `SendGrid reports ${domain} not fully verified`, at);
    }
    const failing = subset.filter(([, r]) => !r.valid);
    if (failing.length === 0) {
      return record("verified", `${label} verified by SendGrid for ${domain}`, at, {
        found: subset.map(describe).join(" · "),
      });
    }
    return record("failed", `Failing records: ${failing.map(([k]) => k).join(", ")}`, at, {
      expected: failing.map(describe).join(" · "),
    });
  };

  return { spf: summarize(spfEntries, "SPF"), dkim: summarize(dkimEntries, "DKIM") };
}

/**
 * Run the real checks for one sender. Returns the fresh status set, or null
 * for senders with no DNS posture (SMS) or no parseable domain.
 */
export async function checkSenderDns(
  deps: DnsCheckDeps,
  sender: Pick<SenderConnection, "type" | "fromEmail">,
): Promise<DomainAuthStatus | null> {
  if (sender.type === "TWILIO_SMS") return null;
  const domain = senderDomain(sender.fromEmail);
  const at = deps.now?.() ?? new Date();
  if (!domain) return null;

  const dmarc = await checkDmarc(deps, domain, at);
  if (sender.type === "CF_MANAGED") {
    const { spf, dkim } = await checkSendGridAuth(deps, domain, at);
    return { spf, dkim, dmarc };
  }
  // OAuth/SMTP tiers: SPF is directly observable; DKIM's selector is not
  // knowable from here — honest `unchecked`, never a guess.
  const spf = await checkDirectSpf(deps, domain, at);
  const dkim = record(
    "unchecked",
    `DKIM selector for ${sender.type} senders isn't discoverable — verify with your provider`,
    at,
  );
  return { spf, dkim, dmarc };
}

/** Check + persist for one sender; returns what was written (null = skipped). */
export async function runSenderDnsCheck(
  deps: DnsCheckDeps & { prisma: PrismaClient },
  params: { workspaceId: string; senderId: string },
): Promise<DomainAuthStatus | null> {
  const sender = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.findFirst({ where: { id: params.senderId, workspaceId: params.workspaceId } }),
  );
  if (!sender) return null;
  const status = await checkSenderDns(deps, sender);
  if (!status) return null;
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.update({
      where: { id: params.senderId },
      data: { domainAuthStatus: status as unknown as Prisma.InputJsonValue },
    }),
  );
  return status;
}
