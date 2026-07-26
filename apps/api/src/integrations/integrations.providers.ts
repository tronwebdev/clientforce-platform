/**
 * DI seam for the integrations vendor spine (INT W1, DEC-093) — the
 * validation.providers pattern: e2e tests override this token with
 * fetch-injected adapters so CI never touches a vendor.
 */
import type { Provider } from "@nestjs/common";
import {
  CalendlyAdapter,
  GoogleCalendarAdapter,
  SlackAdapter,
  type IntegrationsDeps,
} from "@clientforce/integrations";
import { PrismaService } from "../db/prisma.service";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";

export const INTEGRATIONS_DEPS = Symbol("INTEGRATIONS_DEPS");

export const integrationsDepsProvider: Provider = {
  provide: INTEGRATIONS_DEPS,
  inject: [PrismaService, EVENTS_PUBLISHER],
  useFactory: (prisma: PrismaService, publisher: BusOrInlinePublisher): IntegrationsDeps => ({
    prisma: prisma.app,
    // BusEventInput models absent refs as undefined; EventInput allows null —
    // normalize (validateEvent treats them identically downstream).
    publish: async (input) =>
      publisher.publish({
        ...input,
        contactId: input.contactId ?? undefined,
        enrollmentId: input.enrollmentId ?? undefined,
        campaignId: input.campaignId ?? undefined,
        senderId: input.senderId ?? undefined,
      }),
    // INT W2 (DEC-094): gcal reads GOOGLE_CLIENT_ID/SECRET from env (Key
    // Vault-backed; unconfigured = the typed honest owner-clock refusal);
    // calendly is the fields adapter — no platform credentials at all.
    adapters: { slack: new SlackAdapter(), gcal: new GoogleCalendarAdapter(), calendly: new CalendlyAdapter() },
  }),
};
