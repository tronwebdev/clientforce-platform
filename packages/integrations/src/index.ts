/**
 * @clientforce/integrations — the vendor adapter spine for third-party
 * connections (INT W1, DEC-093): one connection model, probe-backed status,
 * typed refusals, allowance-braked outbound delivery. Slack is adapter #1;
 * calendar (W2), Stripe + webhook (W3), and HubSpot (W4) ride the same seam.
 */
export * from "./types";
export * from "./constants";
export * from "./slack";
export * from "./gcal";
export * from "./calendly";
export * from "./service";
export * from "./notify";
export * from "./slots";
export * from "./booking";
export * from "./stripe";
export * from "./payments";
export * from "./webhook-guard";
export * from "./webhook-deliver";

export const INTEGRATIONS_PACKAGE = "@clientforce/integrations";
