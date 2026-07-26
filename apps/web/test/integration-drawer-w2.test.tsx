/**
 * INT W2 (DEC-094): the per-provider drawer states — static render pins (the
 * subcampaign-creator harness style; effects never run, so no fetch fires):
 *   — gcal wizard auth step = the W1 OAuth anatomy + the MANDATED test-user
 *     disclosure + the read-only perms pair ("Step 1 of 3")
 *   — calendly wizard = the canon fields step ("Step 1 of 2"): scheduling-url
 *     input + password token input, NO vendor-perms section, primary Continue
 *   — calendly connected = link row + the honest detection state line (live
 *     vs off-with-add-token) + the webhook-endpoint row only when a token
 *     exists, labeled informational
 *   — gcal connected = calendar · timeZone value + the offer-slots row
 *   — slack wizard stays byte-familiar: no disclosure, the W1 perms pair
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IntegrationDto, IntegrationProvider } from "@clientforce/core";
import { IntegrationDrawer } from "../app/(shell)/integrations/IntegrationDrawer";
import {
  CALENDLY_DETECTION_OFF,
  CALENDLY_DETECTION_ON,
  GCAL_TEST_USER_DISCLOSURE,
  catalogEntry,
} from "../lib/integrations";

const drawer = (provider: IntegrationProvider, row: IntegrationDto | null) => (
  <IntegrationDrawer
    entry={catalogEntry(provider)!}
    provider={provider}
    row={row}
    bootMode="auto"
    canManage
    onClose={() => {}}
    onChanged={() => {}}
  />
);

const connectedRow = (provider: IntegrationProvider, config: unknown): IntegrationDto => ({
  provider,
  status: "connected",
  accountLabel: "acme",
  scopes: [],
  config,
  lastProbeAt: "2026-07-21T10:00:00.000Z",
  lastSyncAt: "2026-07-21T10:00:00.000Z",
  connectedAt: "2026-07-20T10:00:00.000Z",
});

describe("gcal wizard (OAuth anatomy + the mandated disclosure)", () => {
  it("auth step renders the disclosure line, the read-only perms pair, and 3 segments", () => {
    const html = renderToStaticMarkup(drawer("gcal", null));
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain('data-testid="auth-disclosure"');
    expect(html).toContain(GCAL_TEST_USER_DISCLOSURE.replace(/'/g, "&#x27;"));
    expect(html).toContain("Sign in with Google Calendar");
    expect(html).toContain("See when you");
    expect(html).toContain("List your calendars");
  });
});

describe("calendly wizard (the canon fields step — no OAuth grant)", () => {
  it("step 1 is the fields form: url input + password token input, NO perms list, primary Continue", () => {
    const html = renderToStaticMarkup(drawer("calendly", null));
    expect(html).toContain("Step 1 of 2");
    expect(html).toContain('data-testid="calendly-url"');
    expect(html).toContain('data-testid="calendly-token"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Clientforce will be able to");
    expect(html).not.toContain('data-testid="auth-disclosure"');
    expect(html).not.toContain('data-testid="oauth-signin"');
    expect(html).toContain("Continue");
  });
});

describe("slack wizard (W1 rendering pinned — no W2 bleed-through)", () => {
  it("auth step keeps the W1 anatomy: sign-in + the dispatch-locked perms, no disclosure", () => {
    const html = renderToStaticMarkup(drawer("slack", null));
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain("Sign in with Slack");
    expect(html).toContain("Post alerts to the channel you pick");
    expect(html).toContain("See your public channel list");
    expect(html).not.toContain('data-testid="auth-disclosure"');
    expect(html).not.toContain('data-testid="calendly-url"');
  });
});

describe("calendly connected drawer (the two honest tiers)", () => {
  it("detection tier: link row + the LIVE detection line + the informational webhook-endpoint row", () => {
    const html = renderToStaticMarkup(
      drawer(
        "calendly",
        connectedRow("calendly", {
          schedulingUrl: "https://calendly.com/acme/intro",
          webhookToken: "wt_123",
          detection: true,
        }),
      ),
    );
    expect(html).toContain('data-testid="calendly-link"');
    expect(html).toContain("https://calendly.com/acme/intro");
    expect(html).toContain(CALENDLY_DETECTION_ON);
    expect(html).toContain('data-testid="calendly-webhook"');
    expect(html).toContain("Webhook endpoint (created automatically)");
    expect(html).toContain("/webhooks/calendly?token=wt_123");
    expect(html).not.toContain('data-testid="add-token"');
  });

  it("link-only tier: the honest OFF line + the add-token affordance, and NO webhook row", () => {
    const html = renderToStaticMarkup(
      drawer("calendly", connectedRow("calendly", { schedulingUrl: "https://calendly.com/acme/intro" })),
    );
    expect(html).toContain(CALENDLY_DETECTION_OFF);
    expect(html).toContain('data-testid="add-token"');
    expect(html).not.toContain('data-testid="calendly-webhook"');
  });
});

describe("gcal connected drawer", () => {
  it("renders the picked calendar with its OWN timeZone + the offer-slots and bookings rows", () => {
    const html = renderToStaticMarkup(
      drawer(
        "gcal",
        connectedRow("gcal", {
          calendar: { id: "c1", name: "BrightPath — Bookings", timeZone: "America/Chicago" },
          offerSlots: true,
        }),
      ),
    );
    expect(html).toContain('data-testid="calendar-value"');
    expect(html).toContain("BrightPath — Bookings · America/Chicago");
    expect(html).toContain('data-testid="sync-row-offer-slots"');
    expect(html).toContain("Offer open slots in composed copy");
    expect(html).toContain('data-testid="sync-row-bookings"');
    expect(html).toContain("Calendly puts booked meetings on this calendar");
    // The Slack channel row never bleeds into another provider's drawer.
    expect(html).not.toContain('data-testid="channel-value"');
  });

  it("no calendar picked yet → the honest 'Not picked yet' value", () => {
    const html = renderToStaticMarkup(drawer("gcal", connectedRow("gcal", {})));
    expect(html).toContain("Not picked yet");
  });
});
