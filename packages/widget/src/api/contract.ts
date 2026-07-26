/**
 * The widget API seam — ONE documented endpoint, no real backend this unit.
 *
 *   POST {apiBase}/widget/v1/session
 *
 * A public, unauthenticated-but-keyed rail (distinct from the tenant REST
 * surface): the snippet's `widgetId` (wgt_…) is the only credential the page
 * carries; the server resolves it to workspace/agent/campaign so no tenant
 * identifier ever reaches the host page. Every client interaction is one
 * request against this endpoint carrying a discriminated `event`; the server
 * replies with the messages to append plus the agent descriptor.
 *
 * This file is the client-side contract of record for the wiring unit, which
 * promotes these shapes to zod DTOs in @clientforce/core (repo convention)
 * and implements the NestJS module — see the package README for the full
 * request/response examples and the honesty rules the stub follows.
 */
import type { AgentState } from "@clientforce/theme";

export const WIDGET_CONTRACT_VERSION = 1 as const;
export const WIDGET_SESSION_PATH = "/widget/v1/session";

/** Prototype quick-action chips (Behaviour-tab features). */
export type QuickActionKind = "book_call" | "call_me_back" | "get_proposal";

export type WidgetClientEvent =
  | { type: "boot" }
  | { type: "open" }
  | { type: "close" }
  | { type: "visitor_message"; text: string }
  | { type: "quick_action"; action: QuickActionKind }
  | { type: "capture_submit"; fields: Record<string, string> };

export interface WidgetSessionRequest {
  contractVersion: typeof WIDGET_CONTRACT_VERSION;
  widgetId: string;
  /** null on the first (boot) call — the server mints and returns one. */
  sessionId: string | null;
  /** Preview/dev overrides only; the server's widgetId mapping is authoritative. */
  agentId?: string | null;
  campaignId?: string | null;
  event: WidgetClientEvent;
  context?: {
    pageUrl?: string;
    referrer?: string;
    locale?: string;
  };
}

export interface WidgetMessage {
  id: string;
  role: "agent" | "visitor";
  text: string;
  /** ISO-8601 */
  at: string;
}

export interface WidgetQuickAction {
  kind: QuickActionKind;
  label: string;
}

export interface WidgetAgentDescriptor {
  name: string;
  subtitle: string;
  state: AgentState;
}

export interface WidgetSessionResponse {
  contractVersion: typeof WIDGET_CONTRACT_VERSION;
  sessionId: string;
  agent: WidgetAgentDescriptor;
  /** Messages to APPEND (delta, not the full transcript). */
  messages: WidgetMessage[];
  /** Server-offered chips; the client masks them against its feature config. */
  quickActions?: WidgetQuickAction[];
  /** Server-resolved appearance once the builder exists; null from the stub —
   * client config governs until the wiring unit lands. */
  appearance?: Record<string, unknown> | null;
  meta: {
    /** true ⇒ this response came from the stubbed transport, not a live agent. */
    stub: boolean;
  };
}
