/**
 * SPEC A (DEC-099): the pure layer — ranking, spoken dates, and the
 * spoken-register sanitizer that keeps retrieved history from tripping the
 * voice checks.
 */
import { describe, expect, it } from "vitest";
import {
  RECALL_ITEM_MAX_CHARS,
  renderRecallResult,
  sanitizeForSpeech,
  toRecallDetail,
} from "@clientforce/core";
import { overlapScore, rankByQuery, terms } from "../src/rank";
import { spokenWhen } from "../src/when";

describe("terms", () => {
  it("drops stop words and short tokens so intent words carry the match", () => {
    expect(terms("What did we talk about the pricing?")).toEqual(["talk", "pricing"]);
  });

  it("is punctuation- and case-insensitive", () => {
    expect(terms("PRICING, please!")).toEqual(["pricing", "please"]);
  });
});

describe("overlapScore", () => {
  it("scores the share of question terms present", () => {
    expect(overlapScore(["pricing", "demo"], "our pricing is simple")).toBeCloseTo(0.5);
    expect(overlapScore(["pricing", "demo"], "pricing and a demo")).toBe(1);
    expect(overlapScore(["pricing"], "nothing relevant")).toBe(0);
  });

  it("prefix-matches obvious morphology without a stemmer", () => {
    expect(overlapScore(["pricing"], "what does the price include")).toBe(1);
  });

  it("a question with no content terms scores zero against everything", () => {
    expect(overlapScore([], "anything at all")).toBe(0);
  });
});

describe("rankByQuery", () => {
  const rows = [
    { id: "newest", text: "just checking in" },
    { id: "middle", text: "our pricing starts at forty a seat" },
    { id: "oldest", text: "nice to meet you" },
  ];

  it("pulls the matching row up regardless of age", () => {
    const out = rankByQuery(rows, "what was the pricing", (r) => r.text, 2);
    expect(out[0]!.id).toBe("middle");
  });

  it("falls through to pure recency when nothing matches — the 'have we spoken before?' case", () => {
    // The question carries no content terms at all, so every candidate scores
    // 0 and the input order (most-recent-first) must survive intact.
    const out = rankByQuery(rows, "have we spoken before", (r) => r.text, 3);
    expect(out.map((r) => r.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("caps at the limit", () => {
    expect(rankByQuery(rows, "pricing", (r) => r.text, 1)).toHaveLength(1);
  });

  it("is deterministic — the same question over the same rows ranks identically", () => {
    const a = rankByQuery(rows, "pricing seat", (r) => r.text, 3).map((r) => r.id);
    const b = rankByQuery(rows, "pricing seat", (r) => r.text, 3).map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe("spokenWhen", () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("speaks coarse, natural phrases", () => {
    expect(spokenWhen(daysAgo(0), now)).toBe("today");
    expect(spokenWhen(daysAgo(1), now)).toBe("yesterday");
    expect(spokenWhen(daysAgo(3), now)).toBe("3 days ago");
    expect(spokenWhen(daysAgo(9), now)).toBe("last week");
    expect(spokenWhen(daysAgo(21), now)).toBe("about 3 weeks ago");
    expect(spokenWhen(daysAgo(90), now)).toBe("about 3 months ago");
    expect(spokenWhen(daysAgo(400), now)).toBe("about a year ago");
  });

  it("never emits an ISO date the model would have to recite", () => {
    for (const d of [0, 1, 5, 30, 200, 900]) {
      expect(spokenWhen(daysAgo(d), now)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("sanitizeForSpeech", () => {
  it("replaces URLs with a speakable placeholder rather than deleting them", () => {
    // Deleting would let the agent claim the message said nothing about it.
    expect(sanitizeForSpeech("see https://clientforce.io/pricing for details")).toBe(
      "see (a link) for details",
    );
    expect(sanitizeForSpeech("go to www.example.com now")).toBe("go to (a link) now");
  });

  it("replaces email addresses the same way", () => {
    expect(sanitizeForSpeech("reply to sam@acme.test please")).toBe(
      "reply to (an email address) please",
    );
  });

  it("strips markdown, bullets and emoji that TTS would read as garbage", () => {
    expect(sanitizeForSpeech("**bold** and `code`")).toBe("bold and code");
    expect(sanitizeForSpeech("- first\n- second")).toBe("first second");
    expect(sanitizeForSpeech("great 🎉 news")).toBe("great news");
  });

  it("output survives the voice per-sentence checks — the whole point", async () => {
    const { checkComposedVoiceTurn } = await import("@clientforce/channels");
    const nasty = "Check **our pricing** at https://clientforce.io 🎉 or mail sam@acme.test";
    expect(checkComposedVoiceTurn(nasty, { neverSay: [] }).length).toBeGreaterThan(0);
    expect(checkComposedVoiceTurn(sanitizeForSpeech(nasty), { neverSay: [] })).toEqual([]);
  });
});

describe("toRecallDetail", () => {
  it("caps long details and marks the truncation", () => {
    const out = toRecallDetail("x".repeat(RECALL_ITEM_MAX_CHARS + 50));
    expect(out).toHaveLength(RECALL_ITEM_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short details untouched", () => {
    expect(toRecallDetail("  short  fact ")).toBe("short fact");
  });
});

describe("renderRecallResult", () => {
  it("an empty result tells the model to say it has nothing — never to guess", () => {
    const out = renderRecallResult({
      facet: "history",
      found: false,
      items: [],
      note: "There are no earlier messages on record.",
    });
    expect(out).toContain("NOTHING ON RECORD");
    expect(out).toContain("do not guess");
  });

  it("a refusal is distinguishable from an empty record", () => {
    // "We looked and found nothing" and "we could not look" are different
    // claims, and the agent must be able to make the right one.
    const out = renderRecallResult({
      facet: "knowledge",
      found: false,
      items: [],
      refusalReason: "LOOKUP_TIMEOUT",
    });
    expect(out).toContain("NOT AVAILABLE");
    expect(out).not.toContain("NOTHING ON RECORD");
  });

  it("renders found items as labeled lines with their spoken date", () => {
    const out = renderRecallResult({
      facet: "history",
      found: true,
      items: [{ label: "They said · email", detail: "sounds interesting", at: "3 days ago" }],
    });
    expect(out).toContain("1 on record");
    expect(out).toContain("- They said · email (3 days ago): sounds interesting");
  });
});
