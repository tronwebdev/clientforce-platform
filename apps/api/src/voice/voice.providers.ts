import type { Provider } from "@nestjs/common";
import { createCallDialQueue, TwilioVoiceDialer, type VoiceDialer } from "@clientforce/channels";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";

export const VOICE_DIALER = "VOICE_DIALER";
// B3c-1 (DEC-119): the best-time dial queue — null without Redis (the row
// still stores its schedule; the worker fires it when the queue is up).
export const CALL_DIAL_QUEUE_TOKEN = "CALL_DIAL_QUEUE";

export const voiceProviders: Provider[] = [
  // Transport-only dialer — VOICE_SANDBOX default-ON (deterministic CallSid,
  // no network). Tests override with a capturing fake.
  { provide: VOICE_DIALER, useFactory: (): VoiceDialer => new TwilioVoiceDialer() },
  // Refusal + status events (bus with Redis, inline persist without) — Nest
  // providers are module-scoped, so the channels-module pattern repeats here.
  { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
  {
    provide: CALL_DIAL_QUEUE_TOKEN,
    useFactory: () => (process.env.REDIS_URL ? createCallDialQueue() : null),
  },
];
