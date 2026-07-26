/**
 * SPEC A (DEC-099) — the retrieval receipts block on the Calls tab detail.
 *
 * The point of the surface is the honesty check: an agent that said "I don't
 * have that on record" should leave a receipt proving it looked. So the three
 * states must stay visually distinct — found / nothing on record / couldn't
 * check — and the empty one must never be filtered out for tidiness.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RECALL_FACET_META, type CallRetrievalDto } from "@clientforce/core";

const receipt = (over: Partial<CallRetrievalDto> = {}): CallRetrievalDto => ({
  id: `r-${over.seq ?? 0}`,
  callId: "call-1",
  turn: 1,
  seq: 0,
  facet: "history",
  query: "have we spoken before",
  found: true,
  itemCount: 2,
  latencyMs: 41,
  refusalReason: null,
  sources: ["msg-a"],
  createdAt: new Date("2026-07-26T10:00:00Z").toISOString(),
  ...over,
});

/** The component's own state mapper, re-declared here would drift — import it
 *  from the module under test instead. */
async function receiptState(r: CallRetrievalDto) {
  const mod = await import("../app/(shell)/agents/[agentId]/[tab]/CallsTab");
  return (
    mod as unknown as { receiptState: (r: CallRetrievalDto) => { label: string } }
  ).receiptState(r);
}

describe("receipt states — three different claims about the same silence", () => {
  it("a hit reports how many records grounded the answer", async () => {
    expect((await receiptState(receipt({ found: true, itemCount: 3 }))).label).toBe("3 found");
  });

  it("an empty lookup says NOTHING ON RECORD — the agent looked and the record was silent", async () => {
    expect((await receiptState(receipt({ found: false, itemCount: 0 }))).label).toBe(
      "Nothing on record",
    );
  });

  it("a refused lookup says COULDN'T CHECK — the agent never got to look", async () => {
    // Distinct from "nothing on record" on purpose: only one of these is a
    // knowledge gap worth chasing; the other is an infrastructure problem.
    expect(
      (await receiptState(receipt({ found: false, refusalReason: "LOOKUP_TIMEOUT" }))).label,
    ).toBe("Couldn't check");
  });
});

describe("facet labels come from the shared vocabulary", () => {
  it("every facet the ledger can hold has an owner-readable label", () => {
    for (const facet of Object.keys(RECALL_FACET_META)) {
      expect(
        RECALL_FACET_META[facet as keyof typeof RECALL_FACET_META].label.length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the receipts block", () => {
  it("renders one row per lookup, empties included, in call order", async () => {
    const { CallRetrievalsBlock } = await import("../app/(shell)/agents/[agentId]/[tab]/CallsTab");
    const html = renderToStaticMarkup(
      CallRetrievalsBlock({
        retrievals: [
          receipt({ seq: 0, turn: 1, found: true, itemCount: 2 }),
          receipt({
            seq: 1,
            turn: 2,
            facet: "bookings",
            query: "existing booking",
            found: false,
            itemCount: 0,
          }),
          receipt({
            seq: 2,
            turn: 3,
            facet: "knowledge",
            query: "pricing",
            found: false,
            refusalReason: "LOOKUP_TIMEOUT",
          }),
        ],
      }),
    );
    expect(html).toContain("Looked up on this call");
    expect(html).toContain("2 found");
    expect(html).toContain("Nothing on record");
    expect(html).toContain("Couldn&#x27;t check");
    // The caller's question is shown verbatim — that is the audit value.
    expect(html).toContain("have we spoken before");
    expect(html).toContain("existing booking");
    // Facet labels come from the shared vocabulary (HTML-escaped on render).
    expect(html).toContain(RECALL_FACET_META.bookings.label.replace(/&/g, "&amp;"));
    expect(html).toContain(RECALL_FACET_META.history.label);
  });

  it("renders nothing when the call never read the record", async () => {
    // An empty "Looked up: none" block would read as the feature failing,
    // rather than as a call that simply never needed a lookup.
    const { CallRetrievalsBlock } = await import("../app/(shell)/agents/[agentId]/[tab]/CallsTab");
    expect(CallRetrievalsBlock({ retrievals: [] })).toBeNull();
    expect(CallRetrievalsBlock({ retrievals: undefined })).toBeNull();
  });
});
