import { resolveTxt } from "node:dns/promises";
import type { Provider } from "@nestjs/common";
import {
  createClassifyQueue,
  KeylessSandboxSender,
  SendGridSender,
  TwilioSmsSender,
  type DnsCheckDeps,
  type EmailSender,
  type SmsSender,
} from "@clientforce/channels";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { CLASSIFY_QUEUE } from "./webhooks.controller";

export const EMAIL_TRANSPORT = "CHANNELS_EMAIL_TRANSPORT";
// B3b: the api sends console REPLIES synchronously through the boundary — it
// needs an SMS transport too (Twilio's sandbox mode is keyless by design).
export const SMS_TRANSPORT = "CHANNELS_SMS_TRANSPORT";
// P5 W1 (DEC-083): real DNS/provider lookups behind a seam — tests override
// with fixed resolvers so CI never touches the network (vendors mocked).
export const DNS_CHECK_DEPS = "CHANNELS_DNS_CHECK_DEPS";

export const channelsProviders: Provider[] = [
  // CF_MANAGED shared pool (SendGrid, sandbox until P1.8). Tests override.
  // B3b: keyless local/CI environments get the sandbox twin (delivers
  // nothing, mints the same self-controlled ids; refuses in production).
  {
    provide: EMAIL_TRANSPORT,
    useFactory: (): EmailSender =>
      process.env.SENDGRID_API_KEY ? new SendGridSender() : new KeylessSandboxSender(),
  },
  { provide: SMS_TRANSPORT, useFactory: (): SmsSender => new TwilioSmsSender() },
  {
    provide: DNS_CHECK_DEPS,
    useFactory: (): DnsCheckDeps => ({
      resolveTxt,
      ...(process.env.SENDGRID_API_KEY ? { sendgridApiKey: process.env.SENDGRID_API_KEY } : {}),
    }),
  },
  // P1.7: typed events out of the webhooks (bus with Redis, inline without).
  { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
  // P1.7: inbound replies enqueue classification (worker consumes). Null
  // without Redis — the INBOUND Message still persists; tests override.
  {
    provide: CLASSIFY_QUEUE,
    useFactory: () => (process.env.REDIS_URL ? createClassifyQueue() : null),
  },
];
