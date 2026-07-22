/**
 * Widget instance — mount/lifecycle over shadow-DOM isolation.
 *
 * Isolation contract: ONE host element on the page, all markup and styles
 * inside its open shadow root (`:host { all: initial }` + token sheet scoped
 * `:host`). The embed adds nothing to the host document besides the host
 * element itself (and, only when fontLoading:"google" is opted into, one
 * font <link> in <head> — fonts cannot load from inside a shadow root).
 */
import { AGENT_STATES, type AgentState } from "@clientforce/theme";
import themeCss from "@clientforce/theme/console-v3.css?raw";
import widgetCss from "./styles/widget.css?raw";
import { resolveConfig, type ResolvedWidgetConfig, type WidgetInitOptions } from "./config";
import { createTransport, type WidgetTransport } from "./api/transport";
import {
  WIDGET_CONTRACT_VERSION,
  type WidgetClientEvent,
  type WidgetQuickAction,
  type WidgetSessionResponse,
} from "./api/contract";
import { WidgetShell } from "./ui/shell";

export const HOST_ELEMENT_ID = "clientforce-widget-host";
export const FONT_LINK_ID = "clientforce-widget-fonts";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap";
/** How long the orb holds "replying" after a reply lands before settling. */
export const REPLY_SETTLE_MS = 900;

export type WidgetEventName =
  | "ready"
  | "open"
  | "close"
  | "message:sent"
  | "message:received"
  | "agent:state"
  | "error"
  | "destroy";

export type WidgetUpdateOptions = Partial<Omit<WidgetInitOptions, "widgetId">>;

export interface WidgetInstanceOptions {
  doc?: Document;
  transport?: WidgetTransport;
  /** Test hook: overrides the stub transport's think-delay. */
  stubDelayMs?: number;
}

type Listener = (payload?: unknown) => void;

export class WidgetInstance {
  readonly host: HTMLDivElement;
  readonly shadow: ShadowRoot;
  cfg: ResolvedWidgetConfig;

  private readonly doc: Document;
  private readonly shell: WidgetShell;
  private readonly transport: WidgetTransport;
  private readonly listeners = new Map<WidgetEventName, Set<Listener>>();
  private sessionId: string | null = null;
  private agentState: AgentState = "idle";
  private open_ = false;
  private openedOnce = false;
  private interacted = false;
  private unread = 0;
  private destroyed = false;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSends = 0;
  private readonly exitIntentHandler = (e: MouseEvent): void => {
    if (e.relatedTarget === null && e.clientY <= 0) this.triggerAutoOpen("exit-intent");
  };

  constructor(init: WidgetInitOptions, opts: WidgetInstanceOptions = {}) {
    this.doc = opts.doc ?? document;
    this.cfg = resolveConfig(init);
    this.transport =
      opts.transport ??
      createTransport({
        apiBase: this.cfg.apiBase,
        agentName: this.cfg.agentName,
        subtitle: this.cfg.appearance.subtitle,
        welcomeMessage: this.cfg.appearance.welcomeMessage,
        stubDelayMs: opts.stubDelayMs,
      });

    this.host = this.doc.createElement("div");
    this.host.id = HOST_ELEMENT_ID;
    this.host.setAttribute("data-clientforce-widget", this.cfg.widgetId);
    this.shadow = this.host.attachShadow({ mode: "open" });

    const style = this.doc.createElement("style");
    style.textContent = `${themeCss}\n${widgetCss}`;
    this.shadow.appendChild(style);

    this.shell = new WidgetShell(this.doc, {
      onLauncherClick: () => this.toggle(),
      onCloseClick: () => this.close(),
      onSend: (text) => void this.send(text),
      onQuickAction: (action) => void this.quickAction(action),
      onMicClick: () => this.micNotice(),
      onEscape: () => this.close(),
      onInputFocus: () => {
        if (this.pendingSends === 0) this.setAgentState("listening");
      },
      onInputBlur: () => {
        if (this.pendingSends === 0) this.setAgentState("idle");
      },
    });
    this.shadow.appendChild(this.shell.root);
    this.shell.applyConfig(this.cfg);

    this.doc.body.appendChild(this.host);
    this.applyFontLoading();
    this.armBehaviors();
    void this.boot();
  }

  /* ---------------- events ---------------- */

  on(event: WidgetEventName, cb: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: WidgetEventName, cb: Listener): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: WidgetEventName, payload?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* listener errors never break the widget */
      }
    });
  }

  /* ---------------- lifecycle ---------------- */

  private applyFontLoading(): void {
    if (this.cfg.fontLoading !== "google") return;
    if (this.doc.getElementById(FONT_LINK_ID)) return;
    const link = this.doc.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    this.doc.head.appendChild(link);
  }

  private armBehaviors(): void {
    const { openAfterSeconds, exitIntent } = this.cfg.behavior;
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (openAfterSeconds !== null && !this.openedOnce) {
      this.openTimer = setTimeout(
        () => this.triggerAutoOpen("open-after"),
        openAfterSeconds * 1000,
      );
    }
    this.doc.removeEventListener("mouseout", this.exitIntentHandler);
    if (exitIntent) this.doc.addEventListener("mouseout", this.exitIntentHandler);
  }

  private triggerAutoOpen(_source: "open-after" | "exit-intent"): void {
    if (this.destroyed || this.openedOnce) return;
    this.open();
  }

  private async boot(): Promise<void> {
    try {
      const res = await this.request({ type: "boot" });
      this.emit("ready", { sessionId: res.sessionId, stub: res.meta.stub });
    } catch (err) {
      this.showError();
      this.emit("error", err);
    }
  }

  private async request(event: WidgetClientEvent): Promise<WidgetSessionResponse> {
    const res = await this.transport.send({
      contractVersion: WIDGET_CONTRACT_VERSION,
      widgetId: this.cfg.widgetId,
      sessionId: this.sessionId,
      agentId: this.cfg.agentId,
      campaignId: this.cfg.campaignId,
      event,
      context: {
        pageUrl: this.doc.defaultView?.location?.href,
        locale: this.doc.defaultView?.navigator?.language,
      },
    });
    this.sessionId = res.sessionId;
    for (const msg of res.messages) {
      if (msg.role !== "agent") continue;
      this.shell.appendMessage({ role: "agent", text: msg.text });
      this.emit("message:received", msg);
      if (!this.open_ && this.cfg.appearance.showUnreadBadge) {
        this.unread += 1;
        this.shell.setUnread(this.unread);
      }
    }
    if (res.quickActions && !this.interacted) {
      this.shell.setQuickActions(res.quickActions, this.cfg.features);
    }
    return res;
  }

  private showError(): void {
    this.shell.appendMessage({
      role: "agent",
      kind: "error",
      text: "Something went wrong reaching the agent service. Please try again.",
    });
  }

  open(): void {
    if (this.destroyed || this.open_) return;
    this.open_ = true;
    this.openedOnce = true;
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this.unread = 0;
    this.shell.setUnread(0);
    this.shell.setOpen(true);
    this.shell.focusInput();
    this.emit("open");
    void this.request({ type: "open" }).catch(() => undefined);
  }

  close(): void {
    if (this.destroyed || !this.open_) return;
    this.open_ = false;
    this.shell.setOpen(false);
    this.shell.focusLauncher();
    this.emit("close");
    void this.request({ type: "close" }).catch(() => undefined);
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  isOpen(): boolean {
    return this.open_;
  }

  /* ---------------- conversation ---------------- */

  async send(text: string): Promise<void> {
    if (this.destroyed || !text.trim()) return;
    this.markInteracted();
    this.shell.appendMessage({ role: "visitor", text });
    this.emit("message:sent", { text });
    await this.roundTrip({ type: "visitor_message", text });
  }

  private async quickAction(action: WidgetQuickAction): Promise<void> {
    this.markInteracted();
    this.shell.appendMessage({ role: "visitor", text: action.label });
    this.emit("message:sent", { text: action.label, quickAction: action.kind });
    await this.roundTrip({ type: "quick_action", action: action.kind });
  }

  private markInteracted(): void {
    this.interacted = true;
    this.shell.hideQuickActions();
  }

  private async roundTrip(event: WidgetClientEvent): Promise<void> {
    this.pendingSends += 1;
    this.setAgentState("thinking");
    this.shell.setTyping(true);
    try {
      await this.request(event);
      this.setAgentState("replying");
    } catch (err) {
      this.showError();
      this.emit("error", err);
      this.setAgentState("idle");
    } finally {
      this.pendingSends -= 1;
      this.shell.setTyping(false);
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        if (!this.destroyed && this.pendingSends === 0 && this.agentState === "replying") {
          this.setAgentState("idle");
        }
      }, REPLY_SETTLE_MS);
    }
  }

  private micNotice(): void {
    // Honest absence: the mic is canon anatomy; live voice chat has no backend yet.
    this.shell.appendMessage({
      role: "agent",
      text: "Live voice chat arrives with the widget backend unit — the mic isn't functional in this preview.",
    });
  }

  setAgentState(state: AgentState): void {
    if (!AGENT_STATES.includes(state)) {
      console.warn(`[clientforce-widget] unknown agent state ${JSON.stringify(state)}`);
      return;
    }
    if (this.agentState === state) return;
    this.agentState = state;
    this.shell.setAgentState(state);
    this.emit("agent:state", state);
  }

  getAgentState(): AgentState {
    return this.agentState;
  }

  /* ---------------- config ---------------- */

  update(partial: WidgetUpdateOptions): void {
    if (this.destroyed) return;
    const current: WidgetInitOptions = {
      widgetId: this.cfg.widgetId,
      agentId: this.cfg.agentId ?? undefined,
      campaignId: this.cfg.campaignId ?? undefined,
      apiBase: this.cfg.apiBase ?? undefined,
      agentName: this.cfg.agentName,
      zIndex: this.cfg.zIndex,
      fontLoading: this.cfg.fontLoading,
      appearance: { ...this.cfg.appearance },
      behavior: { ...this.cfg.behavior },
      features: { ...this.cfg.features },
    };
    this.cfg = resolveConfig({
      ...current,
      ...partial,
      widgetId: this.cfg.widgetId,
      appearance: { ...current.appearance, ...partial.appearance },
      behavior: { ...current.behavior, ...partial.behavior },
      features: { ...current.features, ...partial.features },
    });
    this.shell.applyConfig(this.cfg);
    this.applyFontLoading();
    this.armBehaviors();
  }

  /* ---------------- teardown ---------------- */

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.doc.removeEventListener("mouseout", this.exitIntentHandler);
    this.host.remove();
    this.emit("destroy");
    this.listeners.clear();
  }
}
