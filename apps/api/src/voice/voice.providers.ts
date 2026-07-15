import type { Provider } from "@nestjs/common";
import { TwilioVoiceDialer, type VoiceDialer } from "@clientforce/channels";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";

export const VOICE_DIALER = "VOICE_DIALER";

export const voiceProviders: Provider[] = [
  // Transport-only dialer — VOICE_SANDBOX default-ON (deterministic CallSid,
  // no network). Tests override with a capturing fake.
  { provide: VOICE_DIALER, useFactory: (): VoiceDialer => new TwilioVoiceDialer() },
  // Refusal + status events (bus with Redis, inline persist without) — Nest
  // providers are module-scoped, so the channels-module pattern repeats here.
  { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
];
