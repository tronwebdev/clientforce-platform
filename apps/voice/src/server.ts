/**
 * The voice service (P3.1, DEC-078) — production build of the spike bridge:
 * an HTTP server answering Twilio's Voice webhook with TwiML that opens a
 * Media Stream (callId + workspaceId bound as stream parameters), plus the
 * WebSocket endpoint running one CallSession per stream.
 *
 * Modes:
 * - PRODUCT (DATABASE_URL set, stream carries callId/workspaceId): full
 *   context load through RLS, transcript + Call finalize + events.
 * - STANDALONE (no DB or no callId): the certification harness / demo rig —
 *   the SAME session code against the demo fixture context; metrics only,
 *   loudly logged. Never silently half-persists.
 *
 * Env: DEEPGRAM_API_KEY + ANTHROPIC_API_KEY (required), PUBLIC_HOST, PORT,
 *      DATABASE_URL/APP_DATABASE_URL (product mode), METRICS_OUT, and the
 *      VOICE_* tunables (config.ts).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import { deriveVoiceMediaToken, voiceMediaTokenValid } from "@clientforce/channels";
import { createAppPrismaClient, type PrismaClient } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { loadVoiceConfig } from "./config";
import { loadAckClips } from "./ack";
import { createVoiceEventsPublisher, type VoiceEventsPublisher } from "./events";
import { mediaStreamUrl, parseMediaRequest } from "./media-url";
import { MetricsCollector } from "./metrics";
import { CallSession, type CallEndReason } from "./session";
import { synthesizeAura } from "./deepgram";
import { createVoiceGateway, finalizeCall, loadCallContextScoped, type CallContext } from "./runtime";
import { demoCallContext } from "./demo-context";
import { outboundClear, outboundMedia, type TwilioInboundMessage } from "./twilio-protocol";

const config = loadVoiceConfig();
const METRICS_OUT = process.env.METRICS_OUT ?? "./metrics.json";

// Deployed-service access gate (P3.1 deploy): with TWILIO_AUTH_TOKEN in the
// env, /twiml and /media require the derived `t=` token — an ungated public
// FQDN would let anyone run sessions on the platform's vendor keys. Without
// the env (local dev, the cert harness, the runner rig) the gate is off.
const mediaToken = process.env.TWILIO_AUTH_TOKEN
  ? deriveVoiceMediaToken(process.env.TWILIO_AUTH_TOKEN)
  : undefined;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

/** TwiML connecting the call to our Media Stream, context bound as parameters. */
function twiml(streamUrl: string, params: Record<string, string>): string {
  const parameters = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `      <Parameter name="${k}" value="${v}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
${parameters}
    </Stream>
  </Connect>
</Response>`;
}

const prisma: PrismaClient | undefined =
  process.env.APP_DATABASE_URL || process.env.DATABASE_URL ? createAppPrismaClient() : undefined;
const publisher: VoiceEventsPublisher | undefined = prisma
  ? createVoiceEventsPublisher(prisma)
  : undefined;

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url?.startsWith("/twiml")) {
    const url = new URL(req.url, `http://${config.publicHost}`);
    if (!voiceMediaTokenValid(mediaToken, url.searchParams.get("t"))) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(
      twiml(mediaStreamUrl(config.publicHost, mediaToken), {
        callId: url.searchParams.get("callId") ?? "",
        workspaceId: url.searchParams.get("workspaceId") ?? "",
        // Demo rig only: picks the disclosure variant of the FIXTURE context
        // per call (a deployed container can't flip env between dials). A
        // product call (callId+workspaceId bound) never reads it.
        demoVariant: url.searchParams.get("demoVariant") ?? "",
      }),
    );
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, host: config.publicHost, mode: prisma ? "product" : "standalone" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

// No `path` option: the gate token rides the PATH (`/media/<token>`) because
// Twilio's <Stream> handshake is not guaranteed to preserve query strings —
// the 2026-07-21 first deployed dial dropped at answer exactly that way.
// Path matching + token validation happen together in the connection handler.
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const media = parseMediaRequest(req.url ?? "");
  if (!media.isMedia || !voiceMediaTokenValid(mediaToken, media.token)) {
    console.error(
      media.isMedia
        ? "[ws] refused: missing/invalid media token"
        : "[ws] refused: not a /media upgrade",
    );
    ws.close(1008, "unauthorized");
    return;
  }
  const deepgramKey = requireEnv("DEEPGRAM_API_KEY");
  const metrics = new MetricsCollector();
  metrics.configEcho = { stt: config.stt, ackAfterMs: config.ackAfterMs };
  const gateway = createVoiceGateway(metrics);
  let streamSid = "";
  let session: CallSession | undefined;
  let context: CallContext | undefined;
  let startedAt = new Date();
  let finalized = false;

  const finish = (endReason: CallEndReason): void => {
    if (finalized) return;
    finalized = true;
    session?.close();
    // A socket that never carried a stream (the workflow's wss handshake
    // preflight, a scanner) leaves no metrics surface — a 0-turn summary
    // here would masquerade as the real call's evidence in container logs.
    if (!streamSid) return;
    const report = metrics.report();
    try {
      writeFileSync(METRICS_OUT, JSON.stringify(report, null, 2));
      console.log(`[metrics] wrote ${METRICS_OUT} — ${report.turns} turns`);
    } catch (err) {
      console.error("[metrics] write failed", (err as Error).message);
    }
    // Numbers-only summary line so a DEPLOYED service surfaces the call's
    // evidence through container logs (the runner can't read METRICS_OUT
    // inside the container). Never transcript text, never numbers dialed.
    console.log(
      `[metrics] summary ${JSON.stringify({
        endReason,
        turns: report.turns,
        callSeconds: report.callSeconds,
        ttfaMs: report.ttfaMs,
        roundTripMs: report.roundTripMs,
        ackRate: report.ackRate,
        commitSources: report.commitSources,
        bargeIns: report.bargeIns.length,
        droppedAudio: report.droppedAudio.length,
        stalledTurns: report.stalledTurns,
        refusals: report.refusals.length,
        disclosureCompleted: report.disclosureCompleted,
        costPerMinuteUsd: Math.round(report.cost.perMinuteUsd * 1000) / 1000,
      })}`,
    );
    if (prisma && publisher && context && session) {
      void finalizeCall({
        prisma,
        publisher,
        context,
        turns: session.transcript(),
        metrics,
        startedAt,
        endReason,
        costAlertUsd: config.costAlertUsdPerCall,
      }).catch((err) => console.error("[finalize]", (err as Error).message));
    } else {
      console.log("[voice] standalone mode — no persistence (metrics only)");
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
      case "start": {
        streamSid = msg.start.streamSid;
        const params = (msg.start as { customParameters?: Record<string, string> }).customParameters ?? {};
        console.log(`[call] stream ${streamSid} started`);
        void (async () => {
          if (prisma && params.callId && params.workspaceId) {
            context = await loadCallContextScoped(prisma, params.workspaceId, params.callId);
          } else {
            context = demoCallContext(params.demoVariant);
            console.log(
              `[voice] standalone context (no callId/workspaceId on the stream) variant=${context.disclosureVariant}`,
            );
          }
          const ackClips = await loadAckClips(deepgramKey, context.ttsModel, config.ackPhrases, synthesizeAura);
          startedAt = new Date();
          session = new CallSession({
            gateway,
            metrics,
            deepgramKey,
            ttsModel: context.ttsModel,
            systemPrompt: context.systemPrompt,
            disclosure: context.disclosure,
            neverSay: context.neverSay,
            sttParams: config.stt,
            ackAfterMs: config.ackAfterMs,
            ackClips,
            stallAbandonMs: config.stallAbandonMs,
            idleTimeoutMs: config.idleTimeoutMs,
            maxCallMs: config.maxCallMs,
            sendAudio: (mulaw) => {
              if (streamSid && ws.readyState === ws.OPEN) ws.send(outboundMedia(streamSid, mulaw));
            },
            clearPlayback: () => {
              if (streamSid && ws.readyState === ws.OPEN) ws.send(outboundClear(streamSid));
            },
            onRefusal: (turn, reason, detail) => {
              if (publisher && context && prisma) {
                void publisher.publish({
                  workspaceId: context.workspaceId,
                  campaignId: context.campaignId,
                  contactId: context.contactId,
                  type: EVENT_TYPES.VOICE_COMPOSE_REFUSED,
                  payload: { callId: context.callId, turn, reason, detail },
                });
              }
            },
            onEnd: (reason) => {
              finish(reason);
              ws.close();
            },
          });
          if (prisma && publisher && context.callId && params.callId) {
            await withCallStarted(prisma, publisher, context);
          }
          session.start();
        })().catch((err) => {
          console.error("[call] start failed:", (err as Error).message);
          ws.close();
        });
        break;
      }
      case "media":
        session?.pushCallerAudio(Buffer.from(msg.media.payload, "base64"));
        break;
      case "stop":
        console.log(`[call] stream ${streamSid} stopped`);
        finish("caller_hangup");
        ws.close();
        break;
      default:
        break;
    }
  });

  ws.on("close", () => finish("caller_hangup"));
  ws.on("error", (err) => console.error("[ws]", err.message));
});

async function withCallStarted(
  db: PrismaClient,
  pub: VoiceEventsPublisher,
  ctx: CallContext,
): Promise<void> {
  const { withTenant } = await import("@clientforce/db");
  await withTenant(db, { workspaceId: ctx.workspaceId }, (tx) =>
    tx.call.update({
      where: { id: ctx.callId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    }),
  );
  await pub.publish({
    workspaceId: ctx.workspaceId,
    campaignId: ctx.campaignId,
    contactId: ctx.contactId,
    type: EVENT_TYPES.CALL_STARTED,
    payload: { callId: ctx.callId },
  });
}

httpServer.listen(config.port, () => {
  console.log(
    `[voice] service on :${config.port}; TwiML host ${config.publicHost}; wss://${config.publicHost}/media; mode=${prisma ? "product" : "standalone"}`,
  );
});
