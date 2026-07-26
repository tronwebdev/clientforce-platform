/**
 * The widget API seam — ONE documented endpoint.
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
 * **The contract of record now lives in `@clientforce/core`** (`widget.ts`,
 * WID2/DEC-101) as zod schemas, shared with the NestJS module that serves this
 * endpoint. This file re-exports it so the shell keeps one local import
 * surface — and it re-exports **types only, deliberately**:
 *
 *   The embed is a script on somebody else's marketing page. It does not
 *   validate its own requests (the server does, and a client-side validator
 *   would be bypassable anyway), so shipping zod to every visitor's browser
 *   would add runtime weight that buys the visitor nothing. `import type` is
 *   erased at build time, so the bundle stays dependency-free while the TYPES
 *   stay identical to the server's. A test pins that no VALUE import of core
 *   reaches this package, and that the two `contractVersion` constants agree.
 */
import type {
  WidgetAgentDescriptor,
  WidgetBranding,
  WidgetCaptureField,
  WidgetCaptureSpec,
  WidgetClientEvent,
  WidgetMessage,
  WidgetOutcome,
  WidgetQuickAction,
  WidgetQuickActionKind,
  WidgetSessionRequest,
  WidgetSessionResponse,
} from "@clientforce/core";

export type {
  WidgetAgentDescriptor,
  WidgetBranding,
  WidgetCaptureField,
  WidgetCaptureSpec,
  WidgetClientEvent,
  WidgetMessage,
  WidgetOutcome,
  WidgetQuickAction,
  WidgetSessionRequest,
  WidgetSessionResponse,
};

/**
 * Entry-chip flows. Each is INDEPENDENTLY enabled per workspace in widget setup
 * (industries use different subsets) — the panel renders only the active ones,
 * never a placeholder for a disabled flow. Live voice is the sixth flow but
 * rides the composer mic, not a chip, so it isn't a quick-action kind.
 * Labels stay server-offered per tenant; the client draws the icon per kind.
 *
 * The shell's local name for core's `WidgetQuickActionKind`.
 */
export type QuickActionKind = WidgetQuickActionKind;

/**
 * VALUES, not types — declared here rather than imported, because importing
 * them would pull core (and zod) into the bundle. Pinned equal to core's by
 * test, which is what keeps the duplication honest.
 */
export const WIDGET_CONTRACT_VERSION = 1 as const;
export const WIDGET_SESSION_PATH = "/widget/v1/session";
