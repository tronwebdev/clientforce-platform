/**
 * Twilio Media Streams wire protocol (the subset the spike uses).
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages
 * Audio is 8kHz mono mulaw, base64 payloads, ~20ms (160 byte) inbound frames.
 */

export interface TwilioStartMessage {
  event: "start";
  streamSid: string;
  start: {
    streamSid: string;
    callSid: string;
    mediaFormat: { encoding: string; sampleRate: number; channels: number };
  };
}

export interface TwilioMediaMessage {
  event: "media";
  streamSid: string;
  media: { payload: string; timestamp?: string; chunk?: string };
}

export interface TwilioMarkMessage {
  event: "mark";
  streamSid: string;
  mark: { name: string };
}

export interface TwilioStopMessage {
  event: "stop";
  streamSid: string;
}

export interface TwilioConnectedMessage {
  event: "connected";
}

export type TwilioInboundMessage =
  | TwilioConnectedMessage
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioMarkMessage
  | TwilioStopMessage;

/** Messages the bridge sends back to Twilio. */
export const outboundMedia = (streamSid: string, mulaw: Buffer) =>
  JSON.stringify({ event: "media", streamSid, media: { payload: mulaw.toString("base64") } });

export const outboundMark = (streamSid: string, name: string) =>
  JSON.stringify({ event: "mark", streamSid, mark: { name } });

/** Empties Twilio's playback buffer — the barge-in primitive. */
export const outboundClear = (streamSid: string) => JSON.stringify({ event: "clear", streamSid });

/** mulaw/8k: 8000 bytes per second of audio. */
export const MULAW_BYTES_PER_SECOND = 8000;
export const FRAME_BYTES = 160; // 20ms
