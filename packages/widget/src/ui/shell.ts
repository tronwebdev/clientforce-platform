/**
 * DOM shell — the prototype live-preview anatomy (launcher cluster + chat
 * panel: brand header with identity orb, thread, quick-action chips, pill
 * composer), built imperatively so the embed ships dependency-free.
 */
import { consoleV3, subtleTextOnColor, textOnColor, type AgentState } from "@clientforce/theme";
import type { QuickActionKind, WidgetQuickAction } from "../api/contract";
import { CORNER_RADIUS_PX, type ResolvedWidgetConfig } from "../config";

export interface ShellHandlers {
  onLauncherClick(): void;
  onCloseClick(): void;
  onSend(text: string): void;
  onQuickAction(action: WidgetQuickAction): void;
  onMicClick(): void;
  onEscape(): void;
  onInputFocus(): void;
  onInputBlur(): void;
}

export interface ShellMessage {
  role: "agent" | "visitor";
  text: string;
  kind?: "chat" | "error";
}

const FEATURE_BY_ACTION: Record<QuickActionKind, keyof ResolvedWidgetConfig["features"]> = {
  book_call: "bookCall",
  call_me_back: "callMeBack",
  get_proposal: "proposal",
};

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class WidgetShell {
  readonly root: HTMLDivElement;
  private readonly doc: Document;
  private readonly handlers: ShellHandlers;

  readonly launcher: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly badge: HTMLSpanElement;
  private readonly panel: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly orb: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly subEl: HTMLSpanElement;
  private readonly messages: HTMLDivElement;
  private readonly typing: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly mic: HTMLButtonElement;

  constructor(doc: Document, handlers: ShellHandlers) {
    this.doc = doc;
    this.handlers = handlers;

    this.root = el(doc, "div", "cfw-root");
    this.root.setAttribute("data-state", "closed");
    this.root.setAttribute("data-agent-state", "idle");
    this.root.setAttribute("data-unread", "0");

    // Launcher cluster: label pill + 60px launcher with unread badge.
    const cluster = el(doc, "div", "cfw-cluster");
    this.label = el(doc, "span", "cfw-label");
    this.launcher = el(doc, "button", "cfw-launcher");
    this.launcher.type = "button";
    this.launcher.appendChild(el(doc, "span", "cfw-launcher-icon", "💬"));
    this.badge = el(doc, "span", "cfw-badge", "1");
    this.badge.setAttribute("aria-hidden", "true");
    this.launcher.appendChild(this.badge);
    this.launcher.addEventListener("click", () => this.handlers.onLauncherClick());
    cluster.appendChild(this.label);
    cluster.appendChild(this.launcher);

    // Panel: header / body (messages + chips) / composer.
    this.panel = el(doc, "div", "cfw-panel");
    this.panel.setAttribute("role", "dialog");

    this.header = el(doc, "div", "cfw-header");
    this.orb = el(doc, "div", "cfw-orb");
    this.orb.setAttribute("data-orb", "");
    const headText = el(doc, "div", "cfw-head-text");
    this.nameEl = el(doc, "div", "cfw-name");
    const sub = el(doc, "div", "cfw-sub");
    sub.appendChild(el(doc, "span", "cfw-dot"));
    this.subEl = el(doc, "span", "cfw-sub-text");
    sub.appendChild(this.subEl);
    headText.appendChild(this.nameEl);
    headText.appendChild(sub);
    const close = el(doc, "button", "cfw-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Close chat");
    close.addEventListener("click", () => this.handlers.onCloseClick());
    this.header.appendChild(this.orb);
    this.header.appendChild(headText);
    this.header.appendChild(close);

    const body = el(doc, "div", "cfw-body");
    this.messages = el(doc, "div", "cfw-messages");
    this.messages.setAttribute("aria-live", "polite");

    this.typing = el(doc, "div", "cfw-row cfw-typing");
    this.typing.appendChild(el(doc, "div", "cfw-msg-orb"));
    const typingBubble = el(doc, "div", "cfw-bubble");
    for (let i = 0; i < 3; i += 1) typingBubble.appendChild(el(doc, "span", "cfw-typing-dot"));
    this.typing.appendChild(typingBubble);

    this.chips = el(doc, "div", "cfw-chips");
    body.appendChild(this.messages);
    body.appendChild(this.chips);

    const composer = el(doc, "div", "cfw-composer");
    this.input = el(doc, "input", "cfw-input");
    this.input.type = "text";
    this.input.placeholder = "Type your message…";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });
    this.input.addEventListener("focus", () => this.handlers.onInputFocus());
    this.input.addEventListener("blur", () => this.handlers.onInputBlur());
    this.mic = el(doc, "button", "cfw-mic", "🎙");
    this.mic.type = "button";
    this.mic.setAttribute("aria-label", "Voice chat");
    this.mic.addEventListener("click", () => this.handlers.onMicClick());
    const send = el(doc, "button", "cfw-send", "➤");
    send.type = "button";
    send.setAttribute("aria-label", "Send message");
    send.addEventListener("click", () => this.submit());
    composer.appendChild(this.input);
    composer.appendChild(this.mic);
    composer.appendChild(send);

    this.panel.appendChild(this.header);
    body.appendChild(composer);
    this.panel.appendChild(body);

    this.root.appendChild(cluster);
    this.root.appendChild(this.panel);
    this.root.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this.handlers.onEscape();
    });
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = "";
    this.handlers.onSend(text);
  }

  applyConfig(cfg: ResolvedWidgetConfig): void {
    const { appearance: a } = cfg;
    const onBrand = a.textOnBrand === "auto" ? textOnColor(a.brandColor) : a.textOnBrand;
    this.root.style.setProperty("--cfw-brand", a.brandColor);
    if (a.brandColor.toLowerCase() === consoleV3.accent) {
      this.root.style.setProperty("--cfw-brand-hover", consoleV3.accentHover);
    } else {
      // Custom brands have no canon hover shade — fall back to the brand fill.
      this.root.style.removeProperty("--cfw-brand-hover");
    }
    this.root.style.setProperty("--cfw-on-brand", onBrand);
    this.root.style.setProperty("--cfw-on-brand-sub", subtleTextOnColor(a.brandColor));
    this.root.style.setProperty("--cfw-radius", `${CORNER_RADIUS_PX[a.corner]}px`);
    this.root.style.setProperty("--cfw-z", String(cfg.zIndex));
    this.root.setAttribute("data-theme", a.theme);
    this.root.setAttribute("data-position", a.position);
    this.root.setAttribute("data-corner", a.corner);
    this.label.textContent = a.launcherText;
    this.launcher.setAttribute("aria-label", a.launcherText);
    this.nameEl.textContent = cfg.agentName;
    this.subEl.textContent = a.subtitle;
    this.orb.textContent = (cfg.agentName.trim().charAt(0) || "A").toLowerCase();
    this.panel.setAttribute("aria-label", cfg.agentName);
    this.mic.style.display = cfg.features.voiceChat ? "" : "none";
    if (!a.showUnreadBadge) this.badge.style.display = "none";
    else this.badge.style.removeProperty("display");
  }

  setOpen(open: boolean): void {
    this.root.setAttribute("data-state", open ? "open" : "closed");
  }

  setAgentState(state: AgentState): void {
    this.root.setAttribute("data-agent-state", state);
  }

  setUnread(count: number): void {
    this.root.setAttribute("data-unread", String(count));
    this.badge.textContent = String(Math.min(count, 9));
  }

  appendMessage(msg: ShellMessage): HTMLDivElement {
    const row = el(this.doc, "div", "cfw-row");
    row.setAttribute("data-role", msg.role);
    if (msg.kind === "error") row.setAttribute("data-kind", "error");
    if (msg.role === "agent") row.appendChild(el(this.doc, "div", "cfw-msg-orb"));
    row.appendChild(el(this.doc, "div", "cfw-bubble", msg.text));
    this.messages.insertBefore(row, this.typing.parentNode === this.messages ? this.typing : null);
    this.messages.scrollTop = this.messages.scrollHeight;
    return row;
  }

  setTyping(on: boolean): void {
    if (on && this.typing.parentNode !== this.messages) {
      this.messages.appendChild(this.typing);
      this.messages.scrollTop = this.messages.scrollHeight;
    } else if (!on && this.typing.parentNode === this.messages) {
      this.messages.removeChild(this.typing);
    }
  }

  setQuickActions(actions: WidgetQuickAction[], features: ResolvedWidgetConfig["features"]): void {
    this.chips.textContent = "";
    for (const action of actions) {
      const featureKey = FEATURE_BY_ACTION[action.kind];
      if (featureKey && !features[featureKey]) continue;
      const chip = el(this.doc, "button", "cfw-chip", action.label);
      chip.type = "button";
      chip.setAttribute("data-action", action.kind);
      chip.addEventListener("click", () => this.handlers.onQuickAction(action));
      this.chips.appendChild(chip);
    }
  }

  hideQuickActions(): void {
    this.chips.textContent = "";
  }

  focusInput(): void {
    this.input.focus();
  }

  focusLauncher(): void {
    this.launcher.focus();
  }
}
