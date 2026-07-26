/**
 * DOM shell — the prototype live-preview anatomy (launcher cluster + chat
 * panel: brand header with identity orb, thread, quick-action chips, pill
 * composer), built imperatively so the embed ships dependency-free.
 */
import {
  AGENT_MARK,
  consoleV3,
  subtleTextOnColor,
  textOnColor,
  type AgentState,
} from "@clientforce/theme";
import type { QuickActionKind, WidgetQuickAction } from "../api/contract";
import { CORNER_RADIUS_PX, type ResolvedWidgetConfig } from "../config";
import markSvg from "@clientforce/theme/assets/mark.svg?raw";
import { iconEl } from "./icons";

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

/** Entry chip → the workspace flow toggle that gates it. */
const FLOW_BY_ACTION: Record<QuickActionKind, keyof ResolvedWidgetConfig["flows"]> = {
  book_visit: "bookVisit",
  call_me_back: "callMeBack",
  schedule_callback: "scheduleCallback",
  estimate: "estimate",
  ask_question: "askQuestion",
};

/**
 * The Clientforce brand mark (packages/theme/assets/mark.svg), inlined. It is
 * PLATFORM-OWNED art: under white-label (attribution suppressed) it is replaced
 * by the ✦ agent mark on the workspace accent — see setPlatformAttribution.
 */
function markEl(doc: Document, size: number): HTMLSpanElement {
  const holder = doc.createElement("span");
  holder.className = "cfw-mark";
  holder.style.width = `${size}px`;
  holder.style.height = `${size}px`;
  holder.setAttribute("aria-hidden", "true");
  holder.innerHTML = markSvg;
  return holder;
}

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
  private readonly scroller: HTMLDivElement;
  private readonly typing: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly mic: HTMLButtonElement;
  private readonly attribution: HTMLDivElement;

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
    // Mock KEY SURFACES: the brand mark on WHITE. Under white-label the ✦ agent
    // mark takes its place (CSS swaps them on [data-white-label]).
    this.launcher.appendChild(markEl(doc, 30));
    this.launcher.appendChild(el(doc, "span", "cfw-agent-mark", AGENT_MARK));
    this.badge = el(doc, "span", "cfw-badge", "1");
    this.badge.setAttribute("aria-hidden", "true");
    this.launcher.appendChild(this.badge);
    this.launcher.addEventListener("click", () => this.handlers.onLauncherClick());
    cluster.appendChild(this.label);
    cluster.appendChild(this.launcher);

    // Panel: header / body (messages + chips) / composer.
    this.panel = el(doc, "div", "cfw-panel");
    this.panel.setAttribute("role", "dialog");
    // Opening moves focus INTO the panel, not into the text field: a focused
    // text field always matches :focus-visible, which would park a ring on the
    // composer (the owner's "never a permanent ring").
    this.panel.setAttribute("tabindex", "-1");

    this.header = el(doc, "div", "cfw-header");
    // The panel mock renders the header tile as the ✦ AGENT mark on the
    // signature gradient (canon §6) — the brand mark is the launcher's.
    // Flagged in the §8 report: the earlier written instruction said the brand
    // mark here, the mock says ✦; the mock wins as the placement source.
    this.orb = el(doc, "div", "cfw-orb");
    this.orb.appendChild(el(doc, "span", "cfw-agent-mark", AGENT_MARK));
    this.orb.setAttribute("data-orb", "");
    const headText = el(doc, "div", "cfw-head-text");
    this.nameEl = el(doc, "div", "cfw-name");
    const sub = el(doc, "div", "cfw-sub");
    sub.appendChild(el(doc, "span", "cfw-dot"));
    this.subEl = el(doc, "span", "cfw-sub-text");
    sub.appendChild(this.subEl);
    headText.appendChild(this.nameEl);
    headText.appendChild(sub);
    const close = el(doc, "button", "cfw-close");
    // 22 renders the mock's 11px ✕ (the path spans half its 24 viewBox).
    close.appendChild(iconEl(doc, "x", 22));
    close.type = "button";
    close.setAttribute("aria-label", "Close chat");
    close.addEventListener("click", () => this.handlers.onCloseClick());
    this.header.appendChild(this.orb);
    this.header.appendChild(headText);
    this.header.appendChild(close);
    // Canon §6 working: a slide sweep under the mark (CSS-gated on the state).
    this.header.appendChild(el(doc, "div", "cfw-sweep"));

    // Body scrolls; the foot (composer + platform line) stays pinned.
    const body = el(doc, "div", "cfw-body");
    this.scroller = body;
    this.messages = el(doc, "div", "cfw-messages");
    this.messages.setAttribute("aria-live", "polite");

    this.typing = el(doc, "div", "cfw-row cfw-typing");
    const typingOrb = el(doc, "div", "cfw-msg-orb");
    typingOrb.appendChild(el(doc, "span", "cfw-agent-mark", AGENT_MARK));
    this.typing.appendChild(typingOrb);
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
    this.mic = el(doc, "button", "cfw-mic");
    this.mic.appendChild(iconEl(doc, "mic", 16));
    this.mic.type = "button";
    this.mic.setAttribute("aria-label", "Voice chat");
    this.mic.addEventListener("click", () => this.handlers.onMicClick());
    const send = el(doc, "button", "cfw-send");
    send.appendChild(iconEl(doc, "arrow-up", 16));
    send.type = "button";
    send.setAttribute("aria-label", "Send message");
    send.addEventListener("click", () => this.submit());
    composer.appendChild(this.input);
    composer.appendChild(this.mic);
    composer.appendChild(send);

    const foot = el(doc, "div", "cfw-foot");
    foot.appendChild(composer);
    // Canon: every panel carries the platform line at the foot.
    this.attribution = el(doc, "div", "cfw-poweredby");
    this.attribution.appendChild(el(doc, "span", "cfw-poweredby-mark"));
    this.attribution.appendChild(
      el(doc, "span", "cfw-poweredby-text", "Powered by Clientforce Ai"),
    );
    foot.appendChild(this.attribution);

    this.panel.appendChild(this.header);
    this.panel.appendChild(body);
    this.panel.appendChild(foot);

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
    if (a.brandColor.toLowerCase() === consoleV3.forest) {
      this.root.style.setProperty("--cfw-brand-hover", consoleV3.forestDeep);
    } else {
      // Custom brands have no canon hover shade — fall back to the brand fill.
      this.root.style.removeProperty("--cfw-brand-hover");
    }
    // The accent never paints a surface, so on-brand tones apply only where a
    // brand FILL survives (the send circle is canon forest; kept for a custom
    // accent whose contrast must still resolve).
    this.root.style.setProperty("--cfw-on-brand", onBrand);
    this.root.style.setProperty("--cfw-on-brand-sub", subtleTextOnColor(a.brandColor));
    this.root.style.setProperty("--cfw-radius", `${CORNER_RADIUS_PX[a.corner]}px`);
    this.root.style.setProperty("--cfw-z", String(cfg.zIndex));
    this.root.setAttribute("data-position", a.position);
    this.root.setAttribute("data-corner", a.corner);
    this.label.textContent = a.launcherText;
    this.launcher.setAttribute("aria-label", a.launcherText);
    this.nameEl.textContent = cfg.agentName;
    this.subEl.textContent = a.subtitle;
    this.panel.setAttribute("aria-label", cfg.agentName);
    this.mic.style.display = cfg.flows.liveVoice ? "" : "none";
    if (!a.showUnreadBadge) this.badge.style.display = "none";
    else this.badge.style.removeProperty("display");
  }

  /**
   * Canon §7: default-on, suppressible ONLY by the server's plan check (the
   * `branding` block). There is deliberately no client-side path to `false` —
   * no data-attribute, no init option — so a host page cannot strip it.
   *
   * Suppression also switches every PLATFORM-OWNED brand asset off the panel
   * (owner ruling 2026-07-26): the brand mark yields to the ✦ agent mark, and
   * the signature gradient — Clientforce's asset, not the workspace's — yields
   * to the workspace accent on the launcher, header tile, message avatars and
   * the working sweep. Same signal, no second flag.
   */
  setPlatformAttribution(show: boolean): void {
    this.attribution.style.display = show ? "" : "none";
    if (show) this.root.removeAttribute("data-white-label");
    else this.root.setAttribute("data-white-label", "");
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
    if (msg.role === "agent") {
      const orb = el(this.doc, "div", "cfw-msg-orb");
      orb.appendChild(el(this.doc, "span", "cfw-agent-mark", AGENT_MARK));
      row.appendChild(orb);
    }
    row.appendChild(el(this.doc, "div", "cfw-bubble", msg.text));
    this.messages.insertBefore(row, this.typing.parentNode === this.messages ? this.typing : null);
    this.scroller.scrollTop = this.scroller.scrollHeight;
    return row;
  }

  setTyping(on: boolean): void {
    if (on && this.typing.parentNode !== this.messages) {
      this.messages.appendChild(this.typing);
      this.scroller.scrollTop = this.scroller.scrollHeight;
    } else if (!on && this.typing.parentNode === this.messages) {
      this.messages.removeChild(this.typing);
    }
  }

  setQuickActions(actions: WidgetQuickAction[], flows: ResolvedWidgetConfig["flows"]): void {
    this.chips.textContent = "";
    let first = true;
    for (const action of actions) {
      const flowKey = FLOW_BY_ACTION[action.kind];
      if (flowKey && !flows[flowKey]) continue;
      // Panel mock: entry chips are TEXT-ONLY pills; the first active flow
      // carries the primary (mint + forest) treatment, the rest are neutral.
      const chip = el(this.doc, "button", "cfw-chip", action.label);
      if (first) {
        chip.setAttribute("data-primary", "");
        first = false;
      }
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

  /** Focus target on open — the panel itself (see the tabindex note above). */
  focusPanel(): void {
    this.panel.focus();
  }

  focusLauncher(): void {
    this.launcher.focus();
  }
}
