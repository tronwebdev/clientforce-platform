/**
 * SPEC A (DEC-099): the mid-call lookup turn, against fake providers.
 *
 * The behaviours that matter on a live call, in order:
 * - a turn that needs a fact CALLS the tool, then answers from what came back;
 * - the caller never sits in silence while it looks (the constant ack), and
 *   never hears two acknowledgements when the model already said one;
 * - a lookup that finds nothing produces an honest turn, not an invention;
 * - the loop is bounded — the last round has no tool, so it must answer;
 * - a barge-in mid-lookup drops the answer on the floor;
 * - lookup turns are reported SEPARATELY from the certified TTFA numbers;
 * - with NO recall wired, the turn loop is the pre-DEC-099 single stream and
 *   no `tools` field goes on the wire at all.
 */
import { describe, expect, it, vi } from "vitest";
import { AiGateway } from "@clientforce/ai";
import type { CompletionProvider, StreamEvent, StreamParams } from "@clientforce/ai";
import { VOICE_LOOKUP_ACK_LINE } from "@clientforce/channels";
import { RECALL_TOOL_NAME, type RecallResult } from "@clientforce/core";
import { buildRecallTool } from "@clientforce/recall";
import { CallSession, type CallSessionDeps, type RecallBrain } from "../src/session";
import { MetricsCollector } from "../src/metrics";
import type { Synthesize } from "../src/deepgram";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A scripted provider: one entry per round, in order. */
type Round = { text?: string; tool?: { facet: string; query: string } };

function scriptedProvider(rounds: Round[], seen: StreamParams[] = []): CompletionProvider {
  let round = 0;
  return {
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async () => {
      throw new Error("not used");
    },
    streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
      // The connection warm-up uses a fixed primer prompt — not a real round.
      if (p.system === "Reply with exactly: ok") {
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
        return;
      }
      seen.push(p);
      const step = rounds[Math.min(round++, rounds.length - 1)]!;
      if (step.text) {
        for (const word of step.text.split(" ")) {
          if (p.signal.aborted) return;
          await sleep(5);
          yield { type: "delta", text: `${word} ` };
        }
      }
      if (step.tool) {
        yield {
          type: "tool_use",
          id: `tu-${round}`,
          name: RECALL_TOOL_NAME,
          input: step.tool,
        };
      }
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

const countingSynthesize = (counter: { spoken: string[] }): Synthesize =>
  async function* (_key, _model, text, signal) {
    counter.spoken.push(text);
    for (let i = 0; i < 2; i++) {
      if (signal.aborted) return;
      await sleep(4);
      yield Buffer.alloc(160, 0xff);
    }
  };

/** Records what the brain was asked; returns whatever the test scripts. */
function fakeBrain(
  result: RecallResult = { facet: "history", found: true, items: [{ label: "They said · email", detail: "asked about pricing" }] },
  opts: { delayMs?: number } = {},
): RecallBrain & { calls: Array<{ facet: string; query: string; turn: number }> } {
  const calls: Array<{ facet: string; query: string; turn: number }> = [];
  return {
    tool: buildRecallTool(),
    calls,
    lookup: async (facet, query, turn) => {
      calls.push({ facet, query, turn });
      if (opts.delayMs) await sleep(opts.delayMs);
      return result;
    },
  };
}

function makeSession(over: Partial<CallSessionDeps> & { provider?: CompletionProvider } = {}) {
  const metrics = new MetricsCollector();
  const counter = { spoken: [] as string[] };
  const audio: Buffer[] = [];
  let clears = 0;
  const { provider, ...deps } = over;
  const session = new CallSession({
    gateway: new AiGateway({
      provider: provider ?? scriptedProvider([{ text: "Sure." }]),
      onUsage: () => {},
    }),
    metrics,
    deepgramKey: "fake",
    ttsModel: "aura-2-thalia-en",
    systemPrompt: "SYSTEM",
    disclosure: "Hi, this is an AI assistant calling on behalf of Acme.",
    neverSay: [],
    sttParams: { model: "nova-2", endpointingMs: 500, utteranceEndMs: 1500, smartFormat: true },
    ackAfterMs: 0,
    ackClips: [],
    stallAbandonMs: 0,
    idleTimeoutMs: 0,
    maxCallMs: 0,
    sendAudio: (b) => audio.push(b),
    clearPlayback: () => {
      clears++;
      audio.splice(0);
    },
    openStt: () => ({ sendAudio: () => {}, close: () => {} }),
    synthesize: countingSynthesize(counter),
    ...deps,
  });
  return { session, metrics, counter, audio, clears: () => clears };
}

describe("the lookup turn — question → scoped lookup → grounded answer", () => {
  it("calls the tool with the model's facet + query, then speaks the grounded answer", async () => {
    const brain = fakeBrain();
    const s = makeSession({
      recall: brain,
      provider: scriptedProvider([
        { tool: { facet: "history", query: "what did we discuss last time" } },
        { text: "Last time you asked about pricing." },
      ]),
    });
    await s.session.driveTurn("Have we spoken before?");

    expect(brain.calls).toEqual([
      { facet: "history", query: "what did we discuss last time", turn: 1 },
    ]);
    expect(s.counter.spoken.join(" ")).toContain("Last time you asked about pricing.");
  });

  it("the tool result is replayed to the model as a tool_result turn", async () => {
    const seen: StreamParams[] = [];
    const s = makeSession({
      recall: fakeBrain(),
      provider: scriptedProvider(
        [{ tool: { facet: "history", query: "prior" } }, { text: "You asked about pricing." }],
        seen,
      ),
    });
    await s.session.driveTurn("Have we spoken?");

    // Round 2 must carry the assistant tool_use turn AND the tool_result turn.
    const second = seen[1]!;
    const blocks = second.turns.flatMap((t) => (Array.isArray(t.content) ? t.content : []));
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
    const result = blocks.find((b) => b.type === "tool_result");
    expect(result).toBeDefined();
    expect((result as { content: string }).content).toContain("asked about pricing");
  });

  it("the last round is sent WITHOUT the tool — a bounded loop must end in an answer", async () => {
    const seen: StreamParams[] = [];
    // A model that would look things up forever if it were allowed to.
    const s = makeSession({
      recall: fakeBrain(),
      provider: scriptedProvider([{ tool: { facet: "history", query: "again and again" } }], seen),
    });
    await s.session.driveTurn("Tell me everything.");

    expect(seen.length).toBe(3); // 2 tool rounds + 1 forced-answer round
    expect(seen[0]!.tools).toBeDefined();
    expect(seen[1]!.tools).toBeDefined();
    expect(seen[2]!.tools).toBeUndefined();
  });
});

describe("latency masking — the caller never sits in silence, and never hears two acks", () => {
  it("speaks the constant ack when the model goes straight to the tool", async () => {
    const s = makeSession({
      recall: fakeBrain(
        { facet: "knowledge", found: true, items: [{ label: "Offer", detail: "forty a seat" }] },
        { delayMs: 20 },
      ),
      provider: scriptedProvider([
        { tool: { facet: "knowledge", query: "pricing" } },
        { text: "It starts at forty a seat." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    expect(s.counter.spoken).toContain(VOICE_LOOKUP_ACK_LINE);
  });

  it("stays QUIET when the model already said its own lead-in", async () => {
    const s = makeSession({
      recall: fakeBrain(),
      provider: scriptedProvider([
        { text: "Let me look.", tool: { facet: "knowledge", query: "pricing" } },
        { text: "It starts at forty a seat." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    expect(s.counter.spoken).not.toContain(VOICE_LOOKUP_ACK_LINE);
    expect(s.counter.spoken.join(" ")).toContain("Let me look.");
  });

  it("the ack never counts as reply TTFA — the certified metric keeps its meaning", async () => {
    const s = makeSession({
      recall: fakeBrain({ facet: "knowledge", found: true, items: [] }, { delayMs: 30 }),
      provider: scriptedProvider([
        { tool: { facet: "knowledge", query: "pricing" } },
        { text: "Forty a seat." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    const turn = s.metrics.turns[0]!;
    // TTFA is stamped by the ANSWER, which lands after the lookup — so it must
    // be at least the lookup's own duration, not the ack's near-instant start.
    expect(turn.ttfaMs).toBeGreaterThanOrEqual(30);
  });
});

describe("honest absence — an empty record must not become an invention", () => {
  it("an empty lookup still reaches the model as an explicit 'nothing on record'", async () => {
    const seen: StreamParams[] = [];
    const s = makeSession({
      recall: fakeBrain({
        facet: "bookings",
        found: false,
        items: [],
        note: "There are no previous calls or bookings on record for this contact.",
      }),
      provider: scriptedProvider(
        [
          { tool: { facet: "bookings", query: "existing booking" } },
          { text: "I don't have a booking in front of me." },
        ],
        seen,
      ),
    });
    await s.session.driveTurn("Can we move my meeting?");

    const blocks = seen[1]!.turns.flatMap((t) => (Array.isArray(t.content) ? t.content : []));
    const result = blocks.find((b) => b.type === "tool_result") as { content: string };
    expect(result.content).toContain("NOTHING ON RECORD");
    expect(result.content).toContain("do not guess");
  });

  it("a REFUSED lookup is distinguishable from an empty one", async () => {
    const seen: StreamParams[] = [];
    const s = makeSession({
      recall: fakeBrain({
        facet: "history",
        found: false,
        items: [],
        refusalReason: "LOOKUP_TIMEOUT",
      }),
      provider: scriptedProvider(
        [{ tool: { facet: "history", query: "prior" } }, { text: "I can't check that right now." }],
        seen,
      ),
    });
    await s.session.driveTurn("What did we agree?");

    const blocks = seen[1]!.turns.flatMap((t) => (Array.isArray(t.content) ? t.content : []));
    const result = blocks.find((b) => b.type === "tool_result") as { content: string };
    expect(result.content).toContain("NOT AVAILABLE");
    expect(result.content).not.toContain("NOTHING ON RECORD");
  });

  it("a malformed tool call refuses by name instead of crashing the turn", async () => {
    const brain = fakeBrain();
    const provider: CompletionProvider = {
      completeText: async () => {
        throw new Error("not used");
      },
      completeTool: async () => {
        throw new Error("not used");
      },
      streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
        if (p.system === "Reply with exactly: ok") {
          yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
          return;
        }
        if (p.tools) {
          // Arguments that do not satisfy the tool schema at all.
          yield { type: "tool_use", id: "bad", name: RECALL_TOOL_NAME, input: { nope: 1 } };
        } else {
          yield { type: "delta", text: "I can't check that." };
        }
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const s = makeSession({ recall: brain, provider });
    await s.session.driveTurn("Anything?");

    // Never reached the store, never threw, and the call carried on speaking.
    expect(brain.calls).toEqual([]);
    expect(s.counter.spoken.join(" ")).toContain("I can't check that.");
  });
});

describe("a lookup can never take the call down", () => {
  it("a THROWING lookup degrades to a refusal — the call keeps going", async () => {
    // Found the hard way: a throw inside the lookup round propagates to
    // respond()'s catch, which reads it as a provider failure and ends the
    // call. A failed database read must cost the answer, not the call.
    const brain: RecallBrain = {
      tool: buildRecallTool(),
      lookup: async () => {
        throw new Error("connection reset");
      },
    };
    const seen: StreamParams[] = [];
    const ends: string[] = [];
    const s = makeSession({
      recall: brain,
      onEnd: (reason) => ends.push(reason),
      provider: scriptedProvider(
        [
          { tool: { facet: "history", query: "prior" } },
          { text: "I can't check that right now." },
        ],
        seen,
      ),
    });
    await s.session.driveTurn("Have we spoken?");

    expect(ends).not.toContain("provider_failure");
    const blocks = seen[1]!.turns.flatMap((t) => (Array.isArray(t.content) ? t.content : []));
    const result = blocks.find((b) => b.type === "tool_result") as { content: string };
    expect(result.content).toContain("NOT AVAILABLE");
    expect(s.counter.spoken.join(" ")).toContain("I can't check that right now.");
  });

  it("renderRecallResult is total — a malformed result degrades instead of throwing", async () => {
    const { renderRecallResult } = await import("@clientforce/core");
    expect(() =>
      renderRecallResult({ facet: "not-a-facet" } as unknown as RecallResult),
    ).not.toThrow();
    expect(renderRecallResult({ facet: "nope" } as unknown as RecallResult)).toContain(
      "NOTHING ON RECORD",
    );
  });
});

describe("barge-in during a lookup", () => {
  it("drops the answer on the floor — the caller has moved on", async () => {
    const brain = fakeBrain(
      { facet: "history", found: true, items: [{ label: "x", detail: "y" }] },
      { delayMs: 120 },
    );
    const s = makeSession({
      recall: brain,
      provider: scriptedProvider([
        { tool: { facet: "history", query: "prior" } },
        { text: "Here is what I found." },
      ]),
    });
    const drive = s.session.driveTurn("Have we spoken?");
    // Interrupt while the lookup is still in flight.
    await sleep(40);
    s.session.testHooks.speechStarted();
    await drive;

    expect(s.counter.spoken.join(" ")).not.toContain("Here is what I found.");
  });
});

describe("metrics — a lookup turn is reported honestly, never blended", () => {
  it("records the lookups and splits TTFA by whether the turn paused to read", async () => {
    const s = makeSession({
      recall: fakeBrain({ facet: "knowledge", found: true, items: [{ label: "a", detail: "b" }] }),
      provider: scriptedProvider([
        { tool: { facet: "knowledge", query: "pricing" } },
        { text: "Forty a seat." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    const report = s.metrics.report();

    expect(report.recall).toMatchObject({ turnsWithLookup: 1, lookups: 1, found: 1, refused: 0 });
    expect(report.ttfaByLookup.withLookup.samples).toBe(1);
    expect(report.ttfaByLookup.withoutLookup.samples).toBe(0);
  });

  it("emptyFacets carries the gaps — the knowledge-gap trigger's input", async () => {
    const s = makeSession({
      recall: fakeBrain({ facet: "knowledge", found: false, items: [] }),
      provider: scriptedProvider([
        { tool: { facet: "knowledge", query: "pricing" } },
        { text: "I don't have that on record." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    expect(s.metrics.report().recall.emptyFacets).toEqual(["knowledge"]);
  });

  it("a REFUSED lookup is NOT a knowledge gap — emptyFacets stays clean", async () => {
    // A timeout means the record was never read; it may well hold the answer.
    // Reporting it as a gap would send the owner to Train Agent to fill a
    // hole that does not exist.
    const s = makeSession({
      recall: fakeBrain({
        facet: "knowledge",
        found: false,
        items: [],
        refusalReason: "LOOKUP_TIMEOUT",
      }),
      provider: scriptedProvider([
        { tool: { facet: "knowledge", query: "pricing" } },
        { text: "I can't check that right now." },
      ]),
    });
    await s.session.driveTurn("What does it cost?");
    const recall = s.metrics.report().recall;
    expect(recall.refused).toBe(1);
    expect(recall.empty).toBe(0);
    expect(recall.emptyFacets).toEqual([]);
  });

  it("counts an empty lookup as empty, not as found", async () => {
    const s = makeSession({
      recall: fakeBrain({ facet: "history", found: false, items: [] }),
      provider: scriptedProvider([
        { tool: { facet: "history", query: "prior" } },
        { text: "Nothing on file." },
      ]),
    });
    await s.session.driveTurn("Have we spoken?");
    expect(s.metrics.report().recall).toMatchObject({ lookups: 1, found: 0, empty: 1, refused: 0 });
  });
});

describe("no recall wired — the pre-DEC-099 path is untouched", () => {
  it("sends NO tools field and runs exactly one round", async () => {
    const seen: StreamParams[] = [];
    const s = makeSession({ provider: scriptedProvider([{ text: "Short reply." }], seen) });
    await s.session.driveTurn("Hello?");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.tools).toBeUndefined();
    expect(s.counter.spoken.join(" ")).toContain("Short reply.");
    expect(s.metrics.report().recall).toMatchObject({ turnsWithLookup: 0, lookups: 0 });
  });

  it("a tool_use event with no brain mounted cannot hang the turn", async () => {
    // Defensive: the model should never emit one (no tool was offered), but a
    // live call must not stall if it does.
    const s = makeSession({
      provider: scriptedProvider([{ text: "Fine.", tool: { facet: "history", query: "x" } }]),
    });
    await vi.waitFor(async () => {
      await s.session.driveTurn("Hi");
      expect(s.counter.spoken.join(" ")).toContain("Fine.");
    });
  });
});
