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

/**
 * Entry-chip flows. Each is INDEPENDENTLY enabled per workspace in widget setup
 * (industries use different subsets) — the panel renders only the active ones,
 * never a placeholder for a disabled flow. Live voice is the sixth flow but
 * rides the composer mic, not a chip, so it isn't a quick-action kind.
 * Labels stay server-offered per tenant; the client draws the icon per kind.
 */
export type QuickActionKind =
  "book_visit" | "call_me_back" | "schedule_callback" | "estimate" | "ask_question";

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
  /**
   * SERVER-AUTHORITATIVE branding. `platformAttribution` is the "Powered by
   * Clientforce Ai" line: default-on for every workspace and NOT workspace-
   * configurable — it may be suppressed only for workspaces owned by an agency
   * whose plan tier includes white-label (canon §7). It deliberately has no
   * data-attribute and no init option: a host page must never be able to switch
   * it off, so the only thing that can suppress it is the plan check behind
   * this endpoint. Absent ⇒ shown.
   */
  branding?: { platformAttribution: boolean };
  meta: {
    /** true ⇒ this response came from the stubbed transport, not a live agent. */
    stub: boolean;
  };
}
