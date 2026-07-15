/**
 * The FREE filters (LH1, DEC-087) — everything that runs BEFORE a paid
 * provider call. Order is pinned by the service (dedupe → cache →
 * suppressed-skip → syntax → MX); these are the pieces.
 */
import { z } from "zod";
import { VALIDATION_MX_TIMEOUT_MS } from "./constants";
import type { ResolveMx } from "./types";

/** The cache/dedupe key — the suppression ledger's lowercase discipline. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

// The same acceptance rule the import DTO uses (z.string().email()) — the
// syntax filter must never refuse an address the import just accepted.
const emailSchema = z.string().email();
export const syntaxValid = (address: string): boolean => emailSchema.safeParse(address).success;

export const domainOf = (address: string): string | null => {
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 ? address.slice(at + 1) : null;
};

export type MxState = "ok" | "none" | "unknown";

/**
 * MX presence per domain, memoized per call. Fail-OPEN semantics: only a
 * definitive empty/no-record answer is "none" (→ invalid); resolver errors
 * and timeouts are "unknown" and proceed to the provider — a flaky resolver
 * must never mint an `invalid`.
 */
export async function checkMxDomains(
  domains: Iterable<string>,
  resolveMx: ResolveMx,
  timeoutMs = VALIDATION_MX_TIMEOUT_MS,
): Promise<Map<string, MxState>> {
  const states = new Map<string, MxState>();
  await Promise.all(
    [...new Set(domains)].map(async (domain) => {
      states.set(domain, await checkMxDomain(domain, resolveMx, timeoutMs));
    }),
  );
  return states;
}

async function checkMxDomain(domain: string, resolveMx: ResolveMx, timeoutMs: number): Promise<MxState> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("MX_TIMEOUT")), timeoutMs);
      }),
    ]);
    return records.length > 0 ? "ok" : "none";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Definitive "this domain has no mail route" answers only.
    if (code === "ENOTFOUND" || code === "ENODATA") return "none";
    return "unknown";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
