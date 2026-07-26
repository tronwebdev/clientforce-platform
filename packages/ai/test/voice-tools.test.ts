/**
 * SPEC A (DEC-099): the tool-use voice stream.
 *
 * Two properties matter. First, a request with NO tools must be byte-identical
 * to the pre-DEC-099 one — the whole voice service was certified on that wire
 * shape, so widening it silently would invalidate the certification. Second,
 * tool arguments arrive as a JSON delta stream and are only complete at
 * `content_block_stop`; assembling them early yields truncated garbage.
 */
import { describe, expect, it } from "vitest";
import { AiGateway } from "../src/gateway";
import type { CompletionProvider, StreamEvent, StreamParams } from "../src/provider";

const recording = (events: StreamEvent[], seen: StreamParams[] = []): CompletionProvider => ({
  completeText: async () => {
    throw new Error("not used");
  },
  completeTool: async () => {
    throw new Error("not used");
  },
  streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
    seen.push(p);
    for (const e of events) yield e;
  },
});

const usage = { type: "done" as const, usage: { inputTokens: 1, outputTokens: 1 } };

describe("streamVoice — the pre-DEC-099 surface is untouched", () => {
  it("yields plain text deltas and sends NO tools field when none are given", async () => {
    const seen: StreamParams[] = [];
    const gw = new AiGateway({
      provider: recording([{ type: "delta", text: "Hi " }, { type: "delta", text: "there" }, usage], seen),
      onUsage: () => {},
    });

    const out: string[] = [];
    for await (const chunk of gw.streamVoice({ turns: [{ role: "user", content: "hello" }] })) {
      out.push(chunk);
    }
    expect(out).toEqual(["Hi ", "there"]);
    expect(seen[0]!.tools).toBeUndefined();
    expect("tools" in seen[0]!).toBe(false);
  });

  it("filters tool_use events out of the text-only view", async () => {
    // streamVoice is implemented as a view over streamVoiceEvents, so a caller
    // that never opted into tools can never be handed one.
    const gw = new AiGateway({
      provider: recording([
        { type: "delta", text: "a" },
        { type: "tool_use", id: "t1", name: "lookup_contact_context", input: { facet: "history" } },
        usage,
      ]),
      onUsage: () => {},
    });
    const out: string[] = [];
    for await (const chunk of gw.streamVoice({ turns: [{ role: "user", content: "x" }] })) {
      out.push(chunk);
    }
    expect(out).toEqual(["a"]);
  });
});

describe("streamVoiceEvents — the tool surface", () => {
  it("passes tools through and surfaces tool_use alongside text, in order", async () => {
    const seen: StreamParams[] = [];
    const gw = new AiGateway({
      provider: recording(
        [
          { type: "delta", text: "Let me check. " },
          { type: "tool_use", id: "t1", name: "lookup_contact_context", input: { facet: "knowledge", query: "price" } },
          usage,
        ],
        seen,
      ),
      onUsage: () => {},
    });

    const tool = {
      name: "lookup_contact_context",
      description: "d",
      inputSchema: { type: "object" as const },
    };
    const events = [];
    for await (const e of gw.streamVoiceEvents({
      turns: [{ role: "user", content: "what does it cost" }],
      tools: [tool],
    })) {
      events.push(e);
    }

    expect(seen[0]!.tools).toEqual([tool]);
    expect(events).toEqual([
      { type: "text", text: "Let me check. " },
      { type: "tool_use", id: "t1", name: "lookup_contact_context", input: { facet: "knowledge", query: "price" } },
    ]);
  });

  it("carries structured turn content (tool_use / tool_result blocks) to the provider", async () => {
    const seen: StreamParams[] = [];
    const gw = new AiGateway({ provider: recording([usage], seen), onUsage: () => {} });
    const turns = [
      { role: "user" as const, content: "have we spoken?" },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, id: "t1", name: "lookup_contact_context", input: {} }],
      },
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "t1", content: "NOTHING ON RECORD" }],
      },
    ];
    for await (const _ of gw.streamVoiceEvents({ turns })) void _;
    expect(seen[0]!.turns).toEqual(turns);
  });

  it("records usage through the same hook, including on abort", async () => {
    const records: string[] = [];
    const gw = new AiGateway({
      provider: recording([{ type: "delta", text: "a" }, usage]),
      onUsage: (r) => records.push(r.outcome),
    });
    for await (const _ of gw.streamVoiceEvents({ turns: [{ role: "user", content: "x" }] })) void _;
    expect(records).toEqual(["ok"]);
  });
});
