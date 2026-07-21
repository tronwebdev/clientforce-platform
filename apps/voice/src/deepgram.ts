/**
 * Deepgram clients (P3.1 production) — raw WebSocket streaming STT + raw
 * fetch Aura-2 TTS, both mulaw/8k native so Twilio audio passes through
 * untranscoded (the ADR-proven path; no SDK, precise timing control).
 *
 * Production deltas over the spike: tunable endpointing params (config.ts —
 * the plan-comment values), `speech_final` surfaced to the TurnGate, a
 * one-shot mid-call reconnect (then fatal — the session speaks the constant
 * goodbye and ends, never a hung line), and the TTS voice model chosen per
 * persona.
 */
import WebSocket from "ws";

export interface SttParams {
  model: string;
  endpointingMs: number;
  utteranceEndMs: number;
  smartFormat: boolean;
}

export interface SttEvents {
  /** VAD onset — barge-in while the agent speaks; hold-cancel for the gate. */
  onSpeechStarted: () => void;
  /** A finalized fragment (is_final) with Deepgram's endpointing verdict. */
  onFinal: (text: string, speechFinal: boolean) => void;
  /** Deepgram's hard stop — utterance_end_ms of true silence. */
  onUtteranceEnd: () => void;
  onError: (err: Error) => void;
  /** Fired only when the stream is gone for good (reconnect exhausted). */
  onFatal: (reason: string) => void;
}

export interface SttStream {
  sendAudio: (mulaw: Buffer) => void;
  close: () => void;
}

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

export function sttUrl(params: SttParams): string {
  const q = new URLSearchParams({
    model: params.model,
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    interim_results: "true",
    vad_events: "true",
    endpointing: String(params.endpointingMs),
    utterance_end_ms: String(params.utteranceEndMs),
    smart_format: String(params.smartFormat),
  });
  return `wss://api.deepgram.com/v1/listen?${q.toString()}`;
}

/**
 * Open the streaming STT socket. One unexpected mid-call close triggers ONE
 * reconnect (fresh socket, same handlers); a second failure is fatal.
 */
export function openSttStream(
  apiKey: string,
  params: SttParams,
  events: SttEvents,
): SttStream {
  let ws: WebSocket;
  let open = false;
  let closedByUs = false;
  let reconnects = 0;
  const pending: Buffer[] = [];

  const connect = (): void => {
    ws = new WebSocket(sttUrl(params), { headers: { Authorization: `Token ${apiKey}` } });
    open = false;
    ws.on("open", () => {
      open = true;
      for (const buf of pending.splice(0)) ws.send(buf);
    });
    ws.on("message", (data) => {
      let msg: DeepgramResult;
      try {
        msg = JSON.parse(String(data)) as DeepgramResult;
      } catch {
        return;
      }
      if (msg.type === "SpeechStarted") {
        events.onSpeechStarted();
      } else if (msg.type === "UtteranceEnd") {
        events.onUtteranceEnd();
      } else if (msg.type === "Results" && msg.is_final) {
        const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
        events.onFinal(text, msg.speech_final === true);
      }
    });
    ws.on("error", (err) => events.onError(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", () => {
      open = false;
      if (closedByUs) return;
      if (reconnects === 0) {
        reconnects += 1;
        events.onError(new Error("stt socket closed mid-call — reconnecting once"));
        connect();
      } else {
        events.onFatal("stt socket closed twice mid-call");
      }
    });
  };
  connect();

  return {
    sendAudio: (mulaw) => {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(mulaw);
      else pending.push(mulaw);
    },
    close: () => {
      closedByUs = true;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch {
        // teardown only
      }
    },
  };
}

/**
 * Stream Aura-2 TTS for `text` as raw mulaw/8k chunks — the persona's model
 * (VOICE_PERSONAS in core). Aborting `signal` cancels generation mid-stream
 * (barge-in, the spike-proven pattern).
 */
export async function* synthesizeAura(
  apiKey: string,
  ttsModel: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  const q = new URLSearchParams({
    model: ttsModel,
    encoding: "mulaw",
    sample_rate: "8000",
    container: "none",
  });
  const res = await fetch(`https://api.deepgram.com/v1/speak?${q.toString()}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Aura TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export type Synthesize = typeof synthesizeAura;
