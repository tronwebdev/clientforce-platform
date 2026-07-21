/**
 * Pure decision logic for the OAuth callback route
 * (`app/integrations/callback/[provider]/route.ts`) — extracted so the
 * state→redirect mapping and error truncation are testable without a server.
 */
import { isIntegrationProvider, type IntegrationProvider } from "@clientforce/core";

/** Redirect querystrings stay owner-readable — cap the vendor/API detail. */
export const DETAIL_MAX = 200;

export function truncateDetail(detail: string, max = DETAIL_MAX): string {
  return detail.length <= max ? detail : `${detail.slice(0, max - 1)}…`;
}

export type CallbackDecision =
  | { kind: "complete"; provider: IntegrationProvider; code: string; state: string }
  | { kind: "error"; detail: string };

/**
 * Classify the vendor's callback query. A vendor `error` wins (rendered
 * verbatim); a missing code/state is the cancelled/failed flow; an unknown
 * provider never reaches the API.
 */
export function decideCallback(
  providerRaw: string,
  params: { code: string | null; state: string | null; error: string | null },
): CallbackDecision {
  if (!isIntegrationProvider(providerRaw)) {
    return { kind: "error", detail: `Unknown integration provider "${providerRaw}"` };
  }
  if (params.error) return { kind: "error", detail: params.error };
  if (!params.code || !params.state) {
    return {
      kind: "error",
      detail: `${providerRaw} did not return an authorization code — the connect flow was cancelled or failed`,
    };
  }
  return { kind: "complete", provider: providerRaw, code: params.code, state: params.state };
}

/**
 * Map a non-OK API response body to the redirect's error detail: a string
 * `detail` wins, then a string `message`, then the honest status fallback.
 */
export function apiErrorDetail(body: unknown, status: number): string {
  if (body !== null && typeof body === "object") {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === "string") return detail;
    if (typeof message === "string") return message;
  }
  return `Connect failed (${status})`;
}

/** The `/integrations?…` query for a callback outcome (URL-encoded, capped). */
export function resultQuery(
  result: { kind: "connected"; provider: string } | { kind: "error"; detail: string },
): string {
  return result.kind === "connected"
    ? `connected=${encodeURIComponent(result.provider)}`
    : `error=${encodeURIComponent(truncateDetail(result.detail))}`;
}
