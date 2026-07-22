import { describe, expect, it } from "vitest";
import { WIDGET_CONTRACT_VERSION, type WidgetSessionRequest } from "../src/api/contract";
import {
  CANON_QUICK_ACTIONS,
  DEFAULT_STUB_DELAY_MS,
  HttpTransport,
  StubTransport,
  createTransport,
} from "../src/api/transport";

function req(
  event: WidgetSessionRequest["event"],
  sessionId: string | null = null,
): WidgetSessionRequest {
  return { contractVersion: WIDGET_CONTRACT_VERSION, widgetId: "wgt_test", sessionId, event };
}

function stub(): StubTransport {
  return new StubTransport({
    agentName: "Acme Sales Agent",
    subtitle: "AI Sales Assistant",
    welcomeMessage: "Hi! 👋 How can I help?",
    delayMs: 0,
  });
}

describe("StubTransport (the seam, exercised without a backend)", () => {
  it("boot mints a session, greets with the configured welcome, and is honestly marked stub", async () => {
    const res = await stub().send(req({ type: "boot" }));
    expect(res.contractVersion).toBe(1);
    expect(res.sessionId).toMatch(/^sess_stub_/);
    expect(res.agent).toEqual({
      name: "Acme Sales Agent",
      subtitle: "AI Sales Assistant",
      state: "idle",
    });
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]).toMatchObject({ role: "agent", text: "Hi! 👋 How can I help?" });
    expect(res.messages[0]!.id).toMatch(/^msg_stub_/);
    expect(res.meta.stub).toBe(true);
    expect(res.appearance).toBeNull();
  });

  it("offers the prototype's three quick actions verbatim", async () => {
    const res = await stub().send(req({ type: "boot" }));
    expect(res.quickActions).toEqual([
      { kind: "book_call", label: "📅 Book a call" },
      { kind: "call_me_back", label: "📞 Call me back" },
      { kind: "get_proposal", label: "📄 Get a proposal" },
    ]);
    expect(CANON_QUICK_ACTIONS.map((a) => a.kind)).toEqual([
      "book_call",
      "call_me_back",
      "get_proposal",
    ]);
  });

  it("keeps one session across calls", async () => {
    const t = stub();
    const boot = await t.send(req({ type: "boot" }));
    const next = await t.send(req({ type: "visitor_message", text: "hello" }, boot.sessionId));
    expect(next.sessionId).toBe(boot.sessionId);
  });

  it("visitor messages get a reply that SAYS it is stubbed — never canned copy posing as a live agent", async () => {
    const res = await stub().send(req({ type: "visitor_message", text: "What do you cost?" }));
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]!.role).toBe("agent");
    expect(res.messages[0]!.text).toMatch(/stub/i);
    expect(res.messages[0]!.text).toMatch(/no live agent|isn't wired|backend unit/i);
    expect(res.meta.stub).toBe(true);
  });

  it("quick actions are acknowledged by name, honestly", async () => {
    const res = await stub().send(req({ type: "quick_action", action: "book_call" }));
    expect(res.messages[0]!.text).toContain("Book a call");
    expect(res.messages[0]!.text).toMatch(/stub|backend unit/i);
  });

  it("open/close round-trips return no messages", async () => {
    const t = stub();
    expect((await t.send(req({ type: "open" }))).messages).toEqual([]);
    expect((await t.send(req({ type: "close" }))).messages).toEqual([]);
  });

  it("default think-delay is visible but short", () => {
    expect(DEFAULT_STUB_DELAY_MS).toBe(600);
  });
});

describe("createTransport / HttpTransport (the wiring-unit shape)", () => {
  it("no apiBase → stub; apiBase → HTTP at the single documented endpoint", () => {
    const base = { agentName: "A", subtitle: "S", welcomeMessage: "W" };
    expect(createTransport({ apiBase: null, ...base })).toBeInstanceOf(StubTransport);
    const http = createTransport({ apiBase: "https://api.example.test/", ...base });
    expect(http).toBeInstanceOf(HttpTransport);
    expect((http as HttpTransport).endpoint).toBe("https://api.example.test/widget/v1/session");
  });
});
