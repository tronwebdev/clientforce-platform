import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WIDGET_CONTRACT_VERSION,
  type WidgetSessionRequest,
  type WidgetSessionResponse,
} from "../src/api/contract";
import type { WidgetTransport } from "../src/api/transport";
import { HOST_ELEMENT_ID, REPLY_SETTLE_MS, WidgetInstance } from "../src/mount";

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Transport whose responses the test resolves by hand. */
class ManualTransport implements WidgetTransport {
  requests: WidgetSessionRequest[] = [];
  private resolvers: Array<(res: WidgetSessionResponse) => void> = [];
  private rejecters: Array<(err: Error) => void> = [];

  send(req: WidgetSessionRequest): Promise<WidgetSessionResponse> {
    this.requests.push(req);
    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejecters.push(reject);
    });
  }

  respond(partial: Partial<WidgetSessionResponse> = {}): void {
    const resolve = this.resolvers.shift();
    this.rejecters.shift();
    resolve?.({
      contractVersion: WIDGET_CONTRACT_VERSION,
      sessionId: "sess_manual_1",
      agent: { name: "Agent", subtitle: "Sub", state: "idle" },
      messages: [],
      meta: { stub: true },
      ...partial,
    });
  }

  fail(): void {
    const reject = this.rejecters.shift();
    this.resolvers.shift();
    reject?.(new Error("transport down"));
  }
}

function create(
  init: Partial<ConstructorParameters<typeof WidgetInstance>[0]> = {},
  opts: ConstructorParameters<typeof WidgetInstance>[1] = {},
): WidgetInstance {
  return new WidgetInstance(
    { widgetId: "wgt_test", behavior: { openAfterSeconds: null }, ...init },
    { stubDelayMs: 0, ...opts },
  );
}

let active: WidgetInstance | null = null;

afterEach(() => {
  active?.destroy();
  active = null;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mount + isolation", () => {
  it("mounts one host with an open shadow root; all markup and styles stay inside it", async () => {
    active = create();
    await flush();
    const hosts = document.querySelectorAll(`#${HOST_ELEMENT_ID}`);
    expect(hosts).toHaveLength(1);
    const shadow = active.shadow;
    expect(shadow.mode ?? "open").toBe("open");
    expect(shadow.querySelector(".cfw-root")).toBeTruthy();
    expect(shadow.querySelector("style")!.textContent).toContain("--cv3-accent");
    // Host document stays clean: no styles, no extra nodes.
    expect(document.head.querySelectorAll("style, link")).toHaveLength(0);
    expect(document.querySelector(".cfw-root")).toBeNull();
  });

  it("boots through the seam: greeting bubble + the three canon chips render; badge shows 1 while closed", async () => {
    active = create();
    await flush();
    const shadow = active.shadow;
    const bubbles = shadow.querySelectorAll('.cfw-row[data-role="agent"] .cfw-bubble');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.textContent).toBe("Hi! 👋 How can I help?");
    const chips = shadow.querySelectorAll(".cfw-chip");
    expect([...chips].map((c) => c.textContent)).toEqual([
      "📅 Book a call",
      "📞 Call me back",
      "📄 Get a proposal",
    ]);
    expect(shadow.querySelector(".cfw-root")!.getAttribute("data-unread")).toBe("1");
  });

  it("feature config masks the server-offered chips and the composer mic", async () => {
    active = create({ features: { callMeBack: false, proposal: false, voiceChat: false } });
    await flush();
    const chips = active.shadow.querySelectorAll(".cfw-chip");
    expect([...chips].map((c) => c.textContent)).toEqual(["📅 Book a call"]);
    expect((active.shadow.querySelector(".cfw-mic") as HTMLElement).style.display).toBe("none");
  });

  it("applies appearance config as instance vars + data attributes", async () => {
    active = create({
      agentName: "Acme Sales Agent",
      appearance: {
        brandColor: "#0F7A28",
        theme: "dark",
        corner: "s",
        position: "left",
        launcherText: "Talk",
      },
    });
    await flush();
    const root = active.shadow.querySelector(".cfw-root") as HTMLElement;
    expect(root.style.getPropertyValue("--cfw-brand")).toBe("#0F7A28");
    expect(root.style.getPropertyValue("--cfw-on-brand")).toBe("#FFFFFF");
    expect(root.style.getPropertyValue("--cfw-radius")).toBe("8px");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-position")).toBe("left");
    expect(active.shadow.querySelector(".cfw-name")!.textContent).toBe("Acme Sales Agent");
    expect(active.shadow.querySelector(".cfw-orb")!.textContent).toBe("a");
    expect(active.shadow.querySelector(".cfw-label")!.textContent).toBe("Talk");
  });
});

describe("open/close lifecycle", () => {
  it("toggles via the launcher, emits events, clears the unread badge on open", async () => {
    active = create();
    await flush();
    const events: string[] = [];
    active.on("open", () => events.push("open"));
    active.on("close", () => events.push("close"));
    const root = active.shadow.querySelector(".cfw-root") as HTMLElement;
    (active.shadow.querySelector(".cfw-launcher") as HTMLElement).click();
    expect(root.getAttribute("data-state")).toBe("open");
    expect(root.getAttribute("data-unread")).toBe("0");
    (active.shadow.querySelector(".cfw-launcher") as HTMLElement).click();
    expect(root.getAttribute("data-state")).toBe("closed");
    expect(events).toEqual(["open", "close"]);
  });

  it("closes on the header ✕ and on Escape", async () => {
    active = create();
    await flush();
    active.open();
    (active.shadow.querySelector(".cfw-close") as HTMLElement).click();
    expect(active.isOpen()).toBe(false);
    active.open();
    const input = active.shadow.querySelector(".cfw-input") as HTMLElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(active.isOpen()).toBe(false);
  });

  it("auto-opens after openAfterSeconds, once", async () => {
    vi.useFakeTimers();
    active = create({ behavior: { openAfterSeconds: 4 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(active.isOpen()).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(active.isOpen()).toBe(true);
    active.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(active.isOpen()).toBe(false);
  });

  it("exit intent (when enabled) opens the widget", async () => {
    active = create({ behavior: { openAfterSeconds: null, exitIntent: true } });
    await flush();
    document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0 }));
    expect(active.isOpen()).toBe(true);
  });
});

describe("conversation round-trip + agent-identity motion states", () => {
  it("send: visitor bubble, thinking + typing during transport, replying then idle after settle", async () => {
    vi.useFakeTimers();
    const transport = new ManualTransport();
    active = create({}, { transport });
    transport.respond({ messages: [] }); // boot
    await vi.advanceTimersByTimeAsync(0);

    const states: string[] = [];
    active.on("agent:state", (s) => states.push(s as string));
    const sendDone = active.send("What does it cost?");
    await vi.advanceTimersByTimeAsync(0);

    const shadow = active.shadow;
    expect(shadow.querySelector('.cfw-row[data-role="visitor"] .cfw-bubble')!.textContent).toBe(
      "What does it cost?",
    );
    const root = shadow.querySelector(".cfw-root") as HTMLElement;
    expect(root.getAttribute("data-agent-state")).toBe("thinking");
    expect(shadow.querySelector(".cfw-typing")!.parentElement).toBeTruthy();

    transport.respond({
      messages: [{ id: "m2", role: "agent", text: "A reply", at: "2026-07-22T00:00:00.000Z" }],
      agent: { name: "Agent", subtitle: "Sub", state: "replying" },
    });
    await sendDone;
    expect(root.getAttribute("data-agent-state")).toBe("replying");
    const agentBubbles = shadow.querySelectorAll('.cfw-row[data-role="agent"] .cfw-bubble');
    expect(agentBubbles[agentBubbles.length - 1]!.textContent).toBe("A reply");

    await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS);
    expect(root.getAttribute("data-agent-state")).toBe("idle");
    expect(states).toEqual(["thinking", "replying", "idle"]);
  });

  it("quick actions send the chip label as the visitor turn and hide the chips", async () => {
    active = create();
    await flush();
    const chip = active.shadow.querySelector('.cfw-chip[data-action="book_call"]') as HTMLElement;
    chip.click();
    await flush();
    expect(active.shadow.querySelectorAll(".cfw-chip")).toHaveLength(0);
    expect(
      active.shadow.querySelector('.cfw-row[data-role="visitor"] .cfw-bubble')!.textContent,
    ).toBe("📅 Book a call");
    const agentBubbles = active.shadow.querySelectorAll('.cfw-row[data-role="agent"] .cfw-bubble');
    expect(agentBubbles[agentBubbles.length - 1]!.textContent).toContain("Book a call");
  });

  it("transport failure renders an honest error bubble, emits error, returns to idle", async () => {
    const transport = new ManualTransport();
    active = create({}, { transport });
    transport.respond(); // boot
    await flush();
    const errors: unknown[] = [];
    active.on("error", (e) => errors.push(e));
    const done = active.send("hello?");
    await flush();
    transport.fail();
    await done;
    const rows = active.shadow.querySelectorAll('.cfw-row[data-kind="error"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toMatch(/went wrong/i);
    expect(errors).toHaveLength(1);
    expect(active.getAgentState()).toBe("idle");
  });

  it("setAgentState rejects unknown states with a warning", async () => {
    active = create();
    await flush();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    active.setAgentState("dancing" as never);
    expect(warn).toHaveBeenCalledOnce();
    expect(active.getAgentState()).toBe("idle");
  });
});

describe("update + destroy", () => {
  it("update re-themes in place (brand, position) without remounting", async () => {
    active = create();
    await flush();
    const root = active.shadow.querySelector(".cfw-root") as HTMLElement;
    active.update({ appearance: { brandColor: "#0E1512", position: "left" } });
    expect(root.style.getPropertyValue("--cfw-brand")).toBe("#0E1512");
    expect(root.getAttribute("data-position")).toBe("left");
    // untouched fields survive the merge
    expect(active.cfg.appearance.launcherText).toBe("Chat with our AI Sales Agent");
    expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(1);
  });

  it("fontLoading:'google' is the ONLY document-level addition, opt-in, once", async () => {
    active = create({ fontLoading: "google" });
    await flush();
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
    active.update({ fontLoading: "google" });
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
  });

  it("destroy removes the host, stops timers/listeners, is idempotent", async () => {
    vi.useFakeTimers();
    active = create({ behavior: { openAfterSeconds: 4, exitIntent: true } });
    await vi.advanceTimersByTimeAsync(0);
    active.destroy();
    expect(document.querySelector(`#${HOST_ELEMENT_ID}`)).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0 }));
    expect(active.isOpen()).toBe(false);
    active.destroy();
    active = null;
  });
});
