import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WIDGET_CONTRACT_VERSION,
  type WidgetSessionRequest,
  type WidgetSessionResponse,
} from "../src/api/contract";
import type { WidgetTransport } from "../src/api/transport";
import { configFromScriptDataset } from "../src/config";
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
    expect(shadow.querySelector("style")!.textContent).toContain("--cv3-forest");
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
    expect(bubbles[0]!.textContent).toContain("I'm Ada, your assistant");
    const chips = shadow.querySelectorAll(".cfw-chip");
    expect([...chips].map((c) => c.textContent)).toEqual([
      "Book a visit",
      "Call me back",
      "Schedule callback",
      "Get an estimate",
      "Ask a question",
    ]);
    // Panel mock: text-only pills, first active flow primary.
    expect(shadow.querySelectorAll(".cfw-chip svg")).toHaveLength(0);
    expect(shadow.querySelectorAll(".cfw-chip[data-primary]")).toHaveLength(1);
    expect(shadow.querySelector(".cfw-chip[data-primary]")!.textContent).toBe("Book a visit");
    expect(shadow.querySelector(".cfw-root")!.getAttribute("data-unread")).toBe("1");
  });

  it("workspace flow config masks the server-offered chips — no placeholder for a disabled flow", async () => {
    active = create({
      flows: {
        callMeBack: false,
        scheduleCallback: false,
        estimate: false,
        liveVoice: false,
      },
    });
    await flush();
    const chips = active.shadow.querySelectorAll(".cfw-chip");
    expect([...chips].map((c) => c.textContent)).toEqual(["Book a visit", "Ask a question"]);
    // liveVoice off ⇒ the mic is gone (it is the sixth flow, not a chip).
    expect((active.shadow.querySelector(".cfw-mic") as HTMLElement).style.display).toBe("none");
  });

  it("the launcher carries the brand mark asset; the header carries the ✦ agent mark", async () => {
    active = create();
    await flush();
    expect(active.shadow.querySelector(".cfw-launcher .cfw-mark svg")).toBeTruthy();
    expect(active.shadow.querySelector(".cfw-orb .cfw-agent-mark")!.textContent).toBe("✦");
    expect(active.shadow.querySelector(".cfw-orb .cfw-mark")).toBeNull();
  });

  it("applies appearance config as instance vars + data attributes", async () => {
    active = create({
      agentName: "Acme Sales Agent",
      appearance: {
        brandColor: "#0F5227",
        corner: "s",
        position: "left",
        launcherText: "Talk",
      },
    });
    await flush();
    const root = active.shadow.querySelector(".cfw-root") as HTMLElement;
    expect(root.style.getPropertyValue("--cfw-brand")).toBe("#0F5227");
    expect(root.style.getPropertyValue("--cfw-on-brand")).toBe("#FFFFFF");
    expect(root.style.getPropertyValue("--cfw-radius")).toBe("9px"); // corner "s"
    expect(root.getAttribute("data-position")).toBe("left");
    expect(active.shadow.querySelector(".cfw-name")!.textContent).toBe("Acme Sales Agent");
    expect(active.shadow.querySelector(".cfw-orb .cfw-agent-mark")!.textContent).toBe("✦");
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
    const chip = active.shadow.querySelector('.cfw-chip[data-action="book_visit"]') as HTMLElement;
    chip.click();
    await flush();
    expect(active.shadow.querySelectorAll(".cfw-chip")).toHaveLength(0);
    expect(
      active.shadow.querySelector('.cfw-row[data-role="visitor"] .cfw-bubble')!.textContent,
    ).toBe("Book a visit");
    const agentBubbles = active.shadow.querySelectorAll('.cfw-row[data-role="agent"] .cfw-bubble');
    expect(agentBubbles[agentBubbles.length - 1]!.textContent).toContain("Book a visit");
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

describe("capture form + outcome card (W2)", () => {
  const SPEC = {
    flow: "scheduleCallback" as const,
    title: "When should we call?",
    submitLabel: "Schedule callback",
    fields: [
      { key: "name", label: "Your name", type: "text" as const, required: true },
      { key: "when", label: "Preferred time", type: "datetime" as const, required: true },
    ],
    consent: { key: "smsReminder", text: "Text me a reminder", required: false },
  };

  /**
   * Boot, then take the schedule-callback chip — the capture form only ever
   * arrives as the server's answer to a flow the visitor chose, so the tests
   * reach it the way a visitor does rather than by calling showCapture().
   *
   * The chip is asserted non-null on purpose: with `?.click()` a missing chip
   * is a silent no-op, and the NEXT respond() then resolves whatever request
   * is still pending — the test goes green-ish against the wrong round trip.
   */
  async function chooseCallbackFlow(transport: ManualTransport): Promise<WidgetInstance> {
    const widget = (active = create({}, { transport }));
    transport.respond({
      quickActions: [{ kind: "schedule_callback", label: "Schedule a callback" }],
    });
    await flush();
    widget.shadow.querySelector<HTMLElement>(".cfw-chip")!.click();
    await flush();
    transport.respond({ capture: SPEC });
    await flush();
    return widget;
  }

  function submitCapture(widget: WidgetInstance): void {
    widget.shadow
      .querySelector<HTMLFormElement>(".cfw-capture")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  it("renders the SERVER's fields — the panel draws them, it does not decide them", async () => {
    const widget = await chooseCallbackFlow(new ManualTransport());

    const form = widget.shadow.querySelector(".cfw-capture");
    expect(form?.getAttribute("data-flow")).toBe("scheduleCallback");
    expect(
      [...widget.shadow.querySelectorAll(".cfw-field-input")].map((i) =>
        i.getAttribute("data-key"),
      ),
    ).toEqual(["name", "when"]);
    // datetime maps to the native picker; the spec's type vocabulary is the
    // server's, the input type is the client's translation of it.
    expect(widget.shadow.querySelector<HTMLInputElement>('[data-key="when"]')?.type).toBe(
      "datetime-local",
    );
    expect(widget.shadow.querySelector(".cfw-consent-text")?.textContent).toBe(
      "Text me a reminder",
    );
    // choosing a flow retires the chips — the visitor has already answered them
    expect(widget.shadow.querySelector(".cfw-chip")).toBeNull();
  });

  it("submitting sends capture_submit with the consent tick as a field", async () => {
    const transport = new ManualTransport();
    const widget = await chooseCallbackFlow(transport);

    widget.shadow.querySelector<HTMLInputElement>('[data-key="name"]')!.value = "Dana Ruiz";
    widget.shadow.querySelector<HTMLInputElement>('[data-key="when"]')!.value = "2026-08-01T10:30";
    widget.shadow.querySelector<HTMLInputElement>(".cfw-consent-box")!.checked = true;
    submitCapture(widget);
    await flush();

    const sent = transport.requests.at(-1)!;
    expect(sent.event).toEqual({
      type: "capture_submit",
      fields: { name: "Dana Ruiz", when: "2026-08-01T10:30", smsReminder: "true" },
    });
    // the form is gone the moment it is submitted — no double-submit surface
    expect(widget.shadow.querySelector(".cfw-capture")).toBeNull();
  });

  it("renders the outcome card ONLY from the server's outcome", async () => {
    const transport = new ManualTransport();
    const widget = await chooseCallbackFlow(transport);
    submitCapture(widget);
    await flush();
    transport.respond({
      outcome: {
        kind: "callback_scheduled",
        title: "Callback scheduled",
        detail: "We'll call Dana on +15551234",
        at: "2026-08-01T10:30:00.000Z",
      },
    });
    await flush();

    const card = widget.shadow.querySelector(".cfw-outcome");
    expect(card?.getAttribute("data-kind")).toBe("callback_scheduled");
    expect(card?.querySelector(".cfw-outcome-title")?.textContent).toBe("Callback scheduled");
    expect(card?.querySelector(".cfw-outcome-detail")?.textContent).toContain("Dana");
  });

  it("no outcome in the response ⇒ no card. The client never invents one", async () => {
    const transport = new ManualTransport();
    const widget = await chooseCallbackFlow(transport);
    submitCapture(widget);
    await flush();
    transport.respond({}); // server wrote nothing, said nothing
    await flush();
    expect(widget.shadow.querySelector(".cfw-outcome")).toBeNull();
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

  it("update carries businessName forward — it must not fall back to the default", async () => {
    active = create({ businessName: "Bright Smile" });
    await flush();
    active.update({ appearance: { position: "left" } });
    expect(active.cfg.businessName).toBe("Bright Smile");
    expect(active.cfg.appearance.welcomeMessage).toContain("Bright Smile's assistant");
  });

  it("update({apiBase}) reaches the seam — stub gives way to the HTTP transport", async () => {
    active = create();
    await flush();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    active.update({ apiBase: "https://widget-api.test" });
    active.open();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      "https://widget-api.test/widget/v1/session",
    );
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

describe("platform attribution — canon §7, plan-gated on the server", () => {
  it("renders by default and stays rendered when the stub attributes", async () => {
    active = create();
    await flush();
    const line = active.shadow.querySelector(".cfw-poweredby") as HTMLElement;
    expect(line.textContent).toContain("Powered by Clientforce Ai");
    expect(line.style.display).toBe("");
  });

  it("only the SERVER can suppress it (plan check behind the endpoint)", async () => {
    const transport = new ManualTransport();
    active = create({}, { transport });
    transport.respond({ branding: { platformAttribution: false } });
    await flush();
    expect((active.shadow.querySelector(".cfw-poweredby") as HTMLElement).style.display).toBe(
      "none",
    );
  });

  it("suppression also flips the panel off platform-owned brand assets", async () => {
    const transport = new ManualTransport();
    active = create({}, { transport });
    transport.respond({ branding: { platformAttribution: false } });
    await flush();
    const root = active.shadow.querySelector(".cfw-root") as HTMLElement;
    expect(root.hasAttribute("data-white-label")).toBe(true);
    // The ✦ agent mark survives — it is the agent's identity, not branding.
    expect(active.shadow.querySelector(".cfw-orb .cfw-agent-mark")!.textContent).toBe("✦");
  });

  it("attribution ON leaves the panel in normal brand mode", async () => {
    active = create();
    await flush();
    expect(
      (active.shadow.querySelector(".cfw-root") as HTMLElement).hasAttribute("data-white-label"),
    ).toBe(false);
  });

  it("a host page CANNOT switch it off — no data-attribute, no init option", async () => {
    const init = configFromScriptDataset({
      widgetId: "wgt_x",
      platformAttribution: "false",
      poweredBy: "false",
      whiteLabel: "true",
    } as unknown as DOMStringMap);
    // Nothing in the client config surface carries attribution/white-label.
    expect(JSON.stringify(init)).not.toMatch(/attribution|poweredBy|whiteLabel/i);
    active = create({ ...init, behavior: { openAfterSeconds: null } });
    await flush();
    expect((active.shadow.querySelector(".cfw-poweredby") as HTMLElement).style.display).toBe("");
  });
});
