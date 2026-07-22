/**
 * Transport seam. `WidgetTransport` is the single boundary the shell talks
 * through; this unit ships the stub (no backend). `HttpTransport` is the thin
 * fetch shape the wiring unit takes over — kept here so the seam is exercised
 * end-to-end by the client even before a server exists.
 *
 * Honesty rail: stub replies say they are stubbed. No canned copy is ever
 * presented as a live agent (meta.stub + the reply text itself).
 */
import {
  WIDGET_CONTRACT_VERSION,
  WIDGET_SESSION_PATH,
  type QuickActionKind,
  type WidgetMessage,
  type WidgetSessionRequest,
  type WidgetSessionResponse,
} from "./contract";

export interface WidgetTransport {
  send(req: WidgetSessionRequest): Promise<WidgetSessionResponse>;
}

/** Prototype chip set, verbatim (labels incl. glyphs). */
export const CANON_QUICK_ACTIONS: ReadonlyArray<{ kind: QuickActionKind; label: string }> = [
  { kind: "book_call", label: "📅 Book a call" },
  { kind: "call_me_back", label: "📞 Call me back" },
  { kind: "get_proposal", label: "📄 Get a proposal" },
];

/** Visible-thinking pause so the motion states read in the demo. */
export const DEFAULT_STUB_DELAY_MS = 600;

const STUB_REPLY =
  "This preview runs on the widget's stubbed transport — there is no live agent yet " +
  "(the real API lands with the widget backend unit). Your message made the full " +
  "round-trip through the client seam, and this reply came back through it.";

function stubAck(action: QuickActionKind): string {
  const label: Record<QuickActionKind, string> = {
    book_call: "Book a call",
    call_me_back: "Call me back",
    get_proposal: "Get a proposal",
  };
  return `“${label[action]}” reached the seam. The live ${label[action].toLowerCase()} flow arrives with the widget backend unit — this stub only confirms the contract.`;
}

export interface StubTransportOptions {
  agentName: string;
  subtitle: string;
  welcomeMessage: string;
  delayMs?: number;
}

export class StubTransport implements WidgetTransport {
  private readonly opts: StubTransportOptions;
  private sessionSeq = 0;
  private messageSeq = 0;
  private sessionId: string | null = null;

  constructor(opts: StubTransportOptions) {
    this.opts = opts;
  }

  private message(text: string): WidgetMessage {
    this.messageSeq += 1;
    return {
      id: `msg_stub_${this.messageSeq}`,
      role: "agent",
      text,
      at: new Date().toISOString(),
    };
  }

  private respond(
    messages: WidgetMessage[],
    state: "idle" | "replying" = "idle",
  ): WidgetSessionResponse {
    if (this.sessionId === null) {
      this.sessionSeq += 1;
      this.sessionId = `sess_stub_${this.sessionSeq}`;
    }
    return {
      contractVersion: WIDGET_CONTRACT_VERSION,
      sessionId: this.sessionId,
      agent: { name: this.opts.agentName, subtitle: this.opts.subtitle, state },
      messages,
      quickActions: CANON_QUICK_ACTIONS.map((a) => ({ ...a })),
      appearance: null,
      meta: { stub: true },
    };
  }

  async send(req: WidgetSessionRequest): Promise<WidgetSessionResponse> {
    const delay = this.opts.delayMs ?? DEFAULT_STUB_DELAY_MS;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    switch (req.event.type) {
      case "boot":
        return this.respond([this.message(this.opts.welcomeMessage)]);
      case "visitor_message":
        return this.respond([this.message(STUB_REPLY)], "replying");
      case "quick_action":
        return this.respond([this.message(stubAck(req.event.action))], "replying");
      case "capture_submit":
        return this.respond(
          [
            this.message(
              "Details received by the stub — capture routing arrives with the widget backend unit.",
            ),
          ],
          "replying",
        );
      case "open":
      case "close":
        return this.respond([]);
    }
  }
}

/** The real-seam shape (unexercised until the wiring unit provides a server). */
export class HttpTransport implements WidgetTransport {
  readonly endpoint: string;

  constructor(apiBase: string) {
    this.endpoint = apiBase.replace(/\/+$/, "") + WIDGET_SESSION_PATH;
  }

  async send(req: WidgetSessionRequest): Promise<WidgetSessionResponse> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`[clientforce-widget] session endpoint ${res.status}`);
    }
    return (await res.json()) as WidgetSessionResponse;
  }
}

export function createTransport(cfg: {
  apiBase: string | null;
  agentName: string;
  subtitle: string;
  welcomeMessage: string;
  stubDelayMs?: number;
}): WidgetTransport {
  if (cfg.apiBase) return new HttpTransport(cfg.apiBase);
  return new StubTransport({
    agentName: cfg.agentName,
    subtitle: cfg.subtitle,
    welcomeMessage: cfg.welcomeMessage,
    delayMs: cfg.stubDelayMs,
  });
}
