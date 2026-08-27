"use client";

/**
 * B3c-2 (DEC-118(1)): the HUMAN in-call card — browser mic through the
 * business line. Anatomy borrowed from the prototype's live-ring widget
 * (dark floating card, pulsing badge, state line, mono meta) rendered in
 * Bold tokens. Two transports, one honest UI:
 *
 *  - real: the Twilio Voice JS SDK Device (dynamic import — the SDK loads
 *    only when a real token arrives); outcomes resolve via the provider's
 *    signed webhooks, never from this client.
 *  - sandbox (keyless): a clearly-labeled practice line — no real call is
 *    placed; the simulated outcome posts to the sandbox-only finish
 *    endpoint, which refuses live rows.
 */
import { useEffect, useRef, useState } from "react";
import { finishBrowserCall } from "./bold-live";

interface TwilioCallLike {
  disconnect(): void;
  mute(muted: boolean): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}
interface TwilioDeviceLike {
  connect(opts: { params: Record<string, string> }): Promise<TwilioCallLike>;
  destroy(): void;
}

export interface BoldCallCardProps {
  callId: string;
  contactName: string;
  sandbox: boolean;
  token?: string;
  onDone: () => void;
  flash: (msg: string) => void;
}

type Phase = "connecting" | "oncall" | "ended" | "error";

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

export function BoldCallCard({ callId, contactName, sandbox, token, onDone, flash }: BoldCallCardProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const callRef = useRef<TwilioCallLike | null>(null);
  const deviceRef = useRef<TwilioDeviceLike | null>(null);
  const phaseRef = useRef<Phase>("connecting");
  phaseRef.current = phase;

  // Connect: the sandbox line answers after a beat; the real one via the SDK.
  useEffect(() => {
    let cancelled = false;
    if (sandbox) {
      const t = setTimeout(() => {
        if (!cancelled) setPhase("oncall");
      }, 900);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    (async () => {
      try {
        const sdk = (await import("@twilio/voice-sdk")) as unknown as {
          Device: new (token: string, opts?: Record<string, unknown>) => TwilioDeviceLike;
        };
        if (cancelled || !token) return;
        const device = new sdk.Device(token, { logLevel: "silent" });
        deviceRef.current = device;
        const call = await device.connect({ params: { callId } });
        if (cancelled) {
          call.disconnect();
          return;
        }
        callRef.current = call;
        call.on("accept", () => setPhase("oncall"));
        call.on("disconnect", () => setPhase("ended"));
        call.on("error", () => setPhase("error"));
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
    };
  }, [sandbox, token, callId]);

  // The on-call timer — the mono meta the duration claim reads from.
  useEffect(() => {
    if (phase !== "oncall") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function endCall() {
    if (phase === "ended" || phase === "error") {
      onDone();
      return;
    }
    if (sandbox) {
      // Practice line: the simulated outcome posts to the sandbox-only
      // endpoint (live rows refuse it — their truth is the provider's).
      const outcome = phase === "oncall" ? "completed" : "canceled";
      await finishBrowserCall(callId, outcome, seconds);
      setPhase("ended");
      flash(outcome === "completed" ? "Call logged." : "Call canceled.");
      return;
    }
    callRef.current?.disconnect();
    setPhase("ended");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    callRef.current?.mute(next);
  }

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const stateLine =
    phase === "connecting"
      ? `Calling ${contactName}…`
      : phase === "oncall"
        ? `On the call with ${contactName}`
        : phase === "error"
          ? "The call could not connect."
          : "Call ended.";

  return (
    <div
      data-testid="bold-callcard"
      style={{
        position: "fixed",
        right: 18,
        bottom: 88,
        width: 296,
        background: "#0C1512",
        borderRadius: 20,
        padding: "16px 18px",
        zIndex: 90,
        boxShadow: "0 18px 44px rgba(10,14,12,.38)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            display: "grid",
            placeItems: "center",
            background: "rgba(53,232,52,.14)",
            color: "var(--cvb-live, #35E834)",
            fontSize: 15,
            animation: phase === "oncall" ? "cvb-pulse 1.6s ease-in-out infinite" : undefined,
          }}
        >
          ☎
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div data-testid="bold-callcard-state" style={{ fontSize: 12.5, fontWeight: 800, color: "#F2F6F2", lineHeight: 1.3 }}>
            {stateLine}
          </div>
          <div style={{ ...mono, fontSize: 10, color: "rgba(242,246,242,.55)", marginTop: 2 }}>
            {phase === "oncall" ? `${mm}:${ss} · your mic is ${muted ? "muted" : "live"}` : "Through your business line"}
          </div>
        </div>
      </div>

      {sandbox ? (
        <div
          data-testid="bold-callcard-sandbox"
          style={{ ...mono, fontSize: 9.5, color: "#D9C87A", background: "rgba(217,200,122,.1)", borderRadius: 8, padding: "5px 8px", marginTop: 10, lineHeight: 1.45 }}
        >
          PRACTICE LINE — no real call is placed on this connection.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {phase === "oncall" ? (
          <button
            onClick={toggleMute}
            data-testid="bold-callcard-mute"
            style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#F2F6F2", background: "rgba(242,246,242,.1)", border: "none", borderRadius: 10, padding: "8px 0", cursor: "pointer" }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        ) : null}
        <button
          onClick={() => void endCall()}
          data-testid="bold-callcard-end"
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 800,
            color: phase === "ended" || phase === "error" ? "var(--cvb-ink, #10241A)" : "#F2B9AF",
            background: phase === "ended" || phase === "error" ? "#EAF5EE" : "rgba(176,72,58,.22)",
            border: "none",
            borderRadius: 10,
            padding: "8px 0",
            cursor: "pointer",
          }}
        >
          {phase === "ended" || phase === "error" ? "Close" : "End the call"}
        </button>
      </div>
    </div>
  );
}
