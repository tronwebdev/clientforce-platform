/**
 * The bridge: an HTTP server that answers Twilio's Voice webhook with TwiML
 * that opens a Media Stream, plus a WebSocket endpoint that runs one
 * CallSession per stream. Throwaway spike server — no auth, no persistence
 * beyond the metrics dump written when the call ends.
 *
 * Env: DEEPGRAM_API_KEY (required), ANTHROPIC_API_KEY (required),
 *      PUBLIC_HOST (the wss host Twilio dials, e.g. the cloudflared hostname),
 *      PORT (default 8080), METRICS_OUT (default ./metrics.json).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import { CallSession } from "./call-session";
import { createVoiceGateway } from "./brain";
import { MetricsCollector } from "./metrics";
import { outboundClear, outboundMedia, type TwilioInboundMessage } from "./twilio-protocol";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? `localhost:${PORT}`;
const METRICS_OUT = process.env.METRICS_OUT ?? "./metrics.json";
const GREETING = "Hi! This is the Clientforce assistant. What are you working on these days?";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

/** TwiML that connects the inbound call to our Media Stream. */
function twiml(host: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media" />
  </Connect>
</Response>`;
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url?.startsWith("/twiml")) {
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(twiml(PUBLIC_HOST));
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, host: PUBLIC_HOST }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/media" });

wss.on("connection", (ws: WebSocket) => {
  const deepgramKey = requireEnv("DEEPGRAM_API_KEY");
  const metrics = new MetricsCollector();
  const gateway = createVoiceGateway(metrics);
  let streamSid = "";

  const session = new CallSession({
    gateway,
    metrics,
    deepgramKey,
    greeting: GREETING,
    sendAudio: (mulaw) => {
      if (streamSid && ws.readyState === ws.OPEN) ws.send(outboundMedia(streamSid, mulaw));
    },
    clearPlayback: () => {
      if (streamSid && ws.readyState === ws.OPEN) ws.send(outboundClear(streamSid));
    },
  });

  const finish = () => {
    session.close();
    const report = metrics.report();
    try {
      writeFileSync(METRICS_OUT, JSON.stringify(report, null, 2));
      console.log(`[metrics] wrote ${METRICS_OUT} — ${report.turns} turns`);
    } catch (err) {
      console.error("[metrics] write failed", (err as Error).message);
    }
  };

  ws.on("message", (raw) => {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(String(raw)) as TwilioInboundMessage;
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        streamSid = msg.start.streamSid;
        console.log(`[call] stream ${streamSid} started`);
        session.start();
        break;
      case "media":
        session.pushCallerAudio(Buffer.from(msg.media.payload, "base64"));
        break;
      case "stop":
        console.log(`[call] stream ${streamSid} stopped`);
        finish();
        ws.close();
        break;
      default:
        break;
    }
  });

  ws.on("close", finish);
  ws.on("error", (err) => console.error("[ws]", err.message));
});

httpServer.listen(PORT, () => {
  console.log(`[voice] bridge on :${PORT}; TwiML host ${PUBLIC_HOST}; wss://${PUBLIC_HOST}/media`);
});
