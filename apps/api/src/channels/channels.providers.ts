import type { Provider } from "@nestjs/common";
import { createClassifyQueue, SendGridSender, type EmailSender } from "@clientforce/channels";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { CLASSIFY_QUEUE } from "./webhooks.controller";

export const EMAIL_TRANSPORT = "CHANNELS_EMAIL_TRANSPORT";

export const channelsProviders: Provider[] = [
  // CF_MANAGED shared pool (SendGrid, sandbox until P1.8). Tests override.
  { provide: EMAIL_TRANSPORT, useFactory: (): EmailSender => new SendGridSender() },
  // P1.7: typed events out of the webhooks (bus with Redis, inline without).
  { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
  // P1.7: inbound replies enqueue classification (worker consumes). Null
  // without Redis — the INBOUND Message still persists; tests override.
  {
    provide: CLASSIFY_QUEUE,
    useFactory: () => (process.env.REDIS_URL ? createClassifyQueue() : null),
  },
];
