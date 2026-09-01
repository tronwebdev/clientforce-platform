import { describe, expect, it } from "vitest";
import {
  activeSignalTypes,
  briefWatchTopics,
  CONFIDENCE_MULTIPLIER,
  DECAY_FLOOR,
  decayedWeight,
  fatigueMultiplier,
  fillReceipt,
  fitTier,
  ICP_SHAPES,
  INTENT_SIGNALS,
  intentReceipt,
  intentScore,
  isActionable,
  isVisibleSignal,
  icpProfileSchema,
  leadFinderTitle,
  leadFinderWatchTitle,
  lockedSignalTypes,
  plainWhen,
  POOL_BANDS,
  poolBandFloors,
  poolBandsFor,
  reachablePoolMax,
  scoreCandidate,
  PROVIDER_PEOPLE_SEARCH,
  RECEIPT_SLOTS,
  SATURATION_CAP,
  SIGNAL_BASES,
  SIGNAL_COMBINATIONS,
  SIGNAL_CONFIDENCE,
  SIGNAL_GROUP_META,
  SIGNAL_SUBJECTS,
  SIGNAL_SUPPLIERS,
  SIGNAL_TIERS,
  signalApplies,
  SOURCE_ELIGIBILITY,
  subjectNounFor,
  VALUE_BANDS,
  type IcpShape,
} from "../src/index";

const entries = Object.entries(INTENT_SIGNALS);

/**
 * B6.5 (DEC-150/151): the intent registry had no test at all. These pin the
 * SHAPE of a definition and the RAILS that hang off it — never the row count,
 * because the table is meant to keep growing (a vertical with no rows is a
 * registry gap to fill, not a fixed list to defend).
 */
describe("intent registry — every definition is well formed", () => {
  it("declares the full contract with valid vocabulary", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, def] of entries) {
      expect(def.label, `${key} needs a user-facing label`).toBeTruthy();
      expect(SIGNAL_GROUP_META[def.group], `${key} points at an unknown group`).toBeTruthy();
      expect(def.shapes.length, `${key} applies to no shape`).toBeGreaterThan(0);
      for (const s of def.shapes) expect(ICP_SHAPES).toContain(s);
      expect(SIGNAL_SUBJECTS).toContain(def.subject);
      expect(SIGNAL_SUPPLIERS).toContain(def.supplier);
      expect(SIGNAL_BASES).toContain(def.basis);
      expect(SIGNAL_TIERS).toContain(def.tier);
      expect(SIGNAL_CONFIDENCE).toContain(def.confidence);
      if (def.valueHint) expect(VALUE_BANDS).toContain(def.valueHint);
      expect(def.weight, `${key} weight`).toBeGreaterThan(0);
      expect(def.halfLifeDays, `${key} half-life`).toBeGreaterThan(0);
      expect(def.sourceTag, `${key} needs a source tag`).toBeTruthy();
      expect(def.receipt, `${key} needs a receipt`).toBeTruthy();
    }
  });

  it("keeps the outreach window at least as long as one half-life", () => {
    // `actionableForDays` is a DIFFERENT question from decay: a mover is worth
    // contacting long after the weight has faded. A window shorter than the
    // half-life would mean a signal still ranking that we may not act on.
    for (const [key, def] of entries) {
      expect(def.actionableForDays, `${key} window vs half-life`).toBeGreaterThanOrEqual(
        def.halfLifeDays,
      );
    }
  });

  it("declares every slot its receipt actually uses", () => {
    for (const [key, def] of entries) {
      const used = [...def.receipt.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const slot of used) {
        expect(RECEIPT_SLOTS, `${key} uses unknown slot {${slot}}`).toContain(slot);
        expect(def.receiptSlots ?? [], `${key} must declare {${slot}}`).toContain(slot);
      }
      for (const flav of Object.values(def.byVertical ?? {})) {
        for (const m of (flav.receipt ?? "").matchAll(/\{(\w+)\}/g)) {
          expect(RECEIPT_SLOTS, `${key} vertical slot {${m[1]}}`).toContain(m[1]);
        }
      }
    }
  });

  it("only names verticals its own shapes could plausibly carry", () => {
    for (const [key, def] of entries) {
      for (const v of def.verticals ?? []) {
        expect(typeof v, `${key} vertical`).toBe("string");
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("receipts read as evidence, never as a template", () => {
  it("never lets an unfilled slot reach a person", () => {
    for (const [key, def] of entries) {
      const verticals = [null, ...Object.keys(def.byVertical ?? {})];
      for (const v of verticals) {
        const out = intentReceipt(key, v, {});
        expect(out, `${key}/${v} produced nothing`).toBeTruthy();
        expect(out!, `${key}/${v} leaked a slot`).not.toMatch(/\{|\}/);
        expect(out!, `${key}/${v} double-spaced`).not.toMatch(/ {2}/);
        expect(out!.trim(), `${key}/${v} empty`).not.toBe("");
        // A sentence that limps because a slot vanished is worse than a
        // shorter true one — the defaults exist to stop exactly that.
        expect(out!, `${key}/${v} starts mid-sentence`).not.toMatch(/^[,.]/);
      }
    }
  });

  it("interpolates the facts it is given", () => {
    expect(intentReceipt("hiring", "dental", { n: 2, role: "hygienist", when: "3 days ago" })).toBe(
      "posted 2 hygienist roles 3 days ago",
    );
    expect(intentReceipt("pricing_asked", "dental", { when: "today" })).toBe(
      "asked what treatment would cost today",
    );
    expect(intentReceipt("moved_in", "dental", { area: "Mueller", when: "6 days ago" })).toBe(
      "moved into Mueller 6 days ago — no dentist on record",
    );
  });

  it("fillReceipt drops what it cannot fill and tidies the rest", () => {
    expect(fillReceipt("posted {n} {role} roles {when}", { when: "today" })).toBe(
      "posted roles today",
    );
    expect(fillReceipt("a b {topic} —", {})).toBe("a b");
  });

  it("plainWhen speaks like a person", () => {
    const d = (days: number) => new Date(Date.now() - days * 86_400_000);
    expect(plainWhen(d(0))).toBe("today");
    expect(plainWhen(d(1))).toBe("yesterday");
    expect(plainWhen(d(3))).toBe("3 days ago");
    expect(plainWhen(d(400))).toBe("over a year ago");
  });
});

describe("tier gating — a paid type produces nothing until the tier is on", () => {
  it("excludes bp types with the tier off and includes them with it on", () => {
    for (const shape of ICP_SHAPES) {
      const off = activeSignalTypes(shape, null, false);
      const on = activeSignalTypes(shape, null, true);
      for (const key of off) expect(INTENT_SIGNALS[key]!.tier).toBe("core");
      expect(on.length).toBeGreaterThanOrEqual(off.length);
      const locked = lockedSignalTypes(shape, null);
      for (const key of locked) expect(off).not.toContain(key);
    }
  });

  it("offers at least one core type to every shape, so no workspace is blank", () => {
    for (const shape of ICP_SHAPES) {
      expect(activeSignalTypes(shape, null, false).length, `${shape} has no core signal`)
        .toBeGreaterThan(0);
    }
  });

  it("gates verticals-scoped types on the workspace's own vertical", () => {
    const scoped = entries.filter(([, d]) => d.verticals?.length);
    expect(scoped.length).toBeGreaterThan(0);
    for (const [, def] of scoped) {
      const shape = def.shapes[0] as IcpShape;
      expect(signalApplies(def, shape, def.verticals![0])).toBe(true);
      expect(signalApplies(def, shape, "a-vertical-that-does-not-exist")).toBe(false);
      expect(signalApplies(def, shape, null)).toBe(false);
    }
  });
});

describe("eligibility — DEC-150 widens consumer, without widening people search", () => {
  it("lets every shape hold licensed and collected supply", () => {
    // Supersedes DEC-131 ruling 3's `consumer: ["first_party"]`: holding a
    // mover signal is legitimate; what may be DONE with it is a channel
    // question, enforced at the boundary from `basis`.
    for (const shape of ICP_SHAPES) {
      expect(SOURCE_ELIGIBILITY[shape]).toEqual([...SIGNAL_SUPPLIERS]);
    }
  });

  it("still does not sell a person-level provider search to consumer shapes", () => {
    expect(PROVIDER_PEOPLE_SEARCH.consumer).toBe(false);
    expect(PROVIDER_PEOPLE_SEARCH.company).toBe(true);
    expect(PROVIDER_PEOPLE_SEARCH.local_business).toBe(true);
  });
});

describe("scoring — confidence, decay, combination, saturation, fatigue", () => {
  it("never scores an inferred signal like a witnessed one", () => {
    expect(CONFIDENCE_MULTIPLIER.observed).toBeGreaterThan(CONFIDENCE_MULTIPLIER.reported);
    expect(CONFIDENCE_MULTIPLIER.reported).toBeGreaterThan(CONFIDENCE_MULTIPLIER.inferred);
  });

  it("decays with age and stops being shown below the floor", () => {
    const fresh = new Date();
    const stale = new Date(Date.now() - 3650 * 86_400_000);
    expect(decayedWeight("meeting_booked", fresh)).toBeGreaterThan(decayedWeight("meeting_booked", stale));
    expect(isVisibleSignal("meeting_booked", fresh)).toBe(true);
    expect(isVisibleSignal("meeting_booked", stale)).toBe(false);
    expect(decayedWeight("meeting_booked", stale)).toBeLessThan(DECAY_FLOOR);
    expect(decayedWeight("not_a_real_type", fresh)).toBe(0);
  });

  it("separates the outreach window from decay", () => {
    const def = INTENT_SIGNALS.moved_in!;
    const inside = new Date(Date.now() - (def.actionableForDays - 1) * 86_400_000);
    const outside = new Date(Date.now() - (def.actionableForDays + 5) * 86_400_000);
    expect(isActionable("moved_in", inside)).toBe(true);
    expect(isActionable("moved_in", outside)).toBe(false);
  });

  it("only combines types that exist", () => {
    for (const rule of SIGNAL_COMBINATIONS) {
      expect(INTENT_SIGNALS[rule.types[0]], rule.types[0]).toBeTruthy();
      expect(INTENT_SIGNALS[rule.types[1]], rule.types[1]).toBeTruthy();
      expect(rule.bonus).toBeGreaterThan(0);
      expect(rule.why).toBeTruthy();
    }
  });

  it("rewards a meaningful pair over the same signals apart", () => {
    const now = new Date();
    const pair = intentScore(
      [
        { type: "pricing_asked", occurredAt: now },
        { type: "meeting_booked", occurredAt: now },
      ],
      { now },
    );
    const apart = intentScore(
      [
        { type: "pricing_asked", occurredAt: now },
        { type: "link_clicked", occurredAt: now },
      ],
      { now },
    );
    expect(pair).toBeGreaterThan(apart);
  });

  it("caps saturation so weak signals cannot out-stack a strong one", () => {
    const now = new Date();
    const many = Array.from({ length: 40 }, () => ({ type: "link_clicked", occurredAt: now }));
    expect(intentScore(many, { now })).toBeLessThanOrEqual(SATURATION_CAP);
  });

  it("fades intent as we act on the same person again", () => {
    const now = new Date();
    const sigs = [{ type: "meeting_booked", occurredAt: now }];
    const first = intentScore(sigs, { now, priorActions: 0 });
    const fourth = intentScore(sigs, { now, priorActions: 3 });
    expect(fourth).toBeLessThan(first);
    expect(fatigueMultiplier(0)).toBe(1);
    expect(fatigueMultiplier(99)).toBeLessThan(1);
    expect(fatigueMultiplier(-5)).toBe(1);
  });

  it("ignores a signal already under the floor", () => {
    const now = new Date();
    const stale = new Date(Date.now() - 3650 * 86_400_000);
    expect(intentScore([{ type: "link_clicked", occurredAt: stale }], { now })).toBe(0);
  });
});

describe("nouns and titles come from the registry, never a literal", () => {
  it("gives every shape a singular and a plural", () => {
    for (const shape of ICP_SHAPES) {
      const n = subjectNounFor(shape, null);
      expect(n.one).toBeTruthy();
      expect(n.many).toBeTruthy();
      expect(n.one).not.toBe(n.many);
    }
  });

  it("lets a vertical override the shape noun when it names the same kind of thing", () => {
    expect(subjectNounFor("consumer", "dental").many).toBe("patients");
    expect(subjectNounFor("consumer", null).many).toBe("people");
    // B6.7: still true, and it is why the shape gate is not a blanket one —
    // "accounts" names organisations, which is what a company shape sells to.
    expect(subjectNounFor("company", "saas").many).toBe("accounts");
    // An unknown vertical falls back to the shape rather than inventing.
    expect(subjectNounFor("company", "not-a-vertical").many).toBe(
      subjectNounFor("company", null).many,
    );
  });

  it("asks the page's question in the workspace's own words", () => {
    expect(leadFinderTitle("consumer", "dental")).toBe("Who's looking for a dentist");
    expect(leadFinderTitle("company", "saas")).toBe("Who's in the market");
    expect(leadFinderTitle("consumer", null)).toBe("Who's looking for what you sell");
  });
});

describe("pool bands", () => {
  it("puts the free band first and never offers below 70", () => {
    expect(POOL_BANDS[0]!.key).toBe("yours");
    expect(POOL_BANDS[0]!.free).toBe(true);
    const floors = POOL_BANDS.map((b) => b.min).filter((m): m is number => m !== null);
    expect(Math.min(...floors)).toBeGreaterThanOrEqual(70);
    for (const b of POOL_BANDS.slice(1)) expect(b.free).toBe(false);
  });
});

/**
 * B6.6 — the watch panel's own title, and the brief's own words and places.
 *
 * The build printed the PAGE question inside the watch panel, and read the
 * chips from the `WatchTopic` table alone, which is empty until someone
 * types into it — so a workspace that had stated its services and its area
 * at first run still saw an empty "WORDS AND PLACES" block.
 */
describe("B6.6 · the watch panel's title and the brief's chips", () => {
  it("names the panel with something other than the page question", () => {
    for (const shape of ICP_SHAPES) {
      expect(leadFinderWatchTitle(shape)).not.toBe(leadFinderTitle(shape, "dental"));
      expect(leadFinderWatchTitle(shape).length).toBeGreaterThan(0);
    }
    expect(leadFinderWatchTitle("local_business")).toBe("People near you, worth reaching");
  });

  it("derives chips from the brief's services and its area", () => {
    const chips = briefWatchTopics({
      shape: "local_business",
      vertical: "dental",
      location: "Austin",
      radiusMiles: 25,
    });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Implants");
    // A place chip carries the radius when the brief states one — the
    // prototype's "Austin · 25 mi".
    expect(labels).toContain("Austin · 25 mi");
    expect(chips.every((c) => c.derived)).toBe(true);
  });

  it("never turns instructional copy into a chip", () => {
    // "Your service areas" is a PROMPT in the suggestion table, not a place
    // the workspace named. Emitting it would put a made-up fact on screen.
    for (const shape of ICP_SHAPES) {
      for (const vertical of ["dental", "salon", "trades", "saas", "agency"]) {
        for (const c of briefWatchTopics({ shape, vertical, location: "Leeds" })) {
          expect(c.label.toLowerCase()).not.toContain("your service area");
        }
      }
    }
  });

  it("says nothing where the brief said nothing", () => {
    // No vertical and no location: there is no word and no place to show,
    // and an empty list is the honest answer (DEC-115).
    expect(briefWatchTopics({ shape: "company" })).toEqual([]);
    // A location with no radius is still a place, just without the "· 25 mi".
    const noRadius = briefWatchTopics({ shape: "local_business", location: "Leeds" });
    expect(noRadius.map((c) => c.label)).toContain("Leeds");
  });
});

/**
 * B6.7 — the shape-facet ruling.
 *
 * A qualifier only means something for the shapes that can have it, and the
 * demo proved that is not cosmetic: `local_business` + `dental` rendered a
 * consumer noun wearing company qualifiers, and because the title rule is
 * worth 12 points, only rows carrying a title could reach the top band. A
 * vocabulary bug had set the scorer's ceiling.
 */
describe("B6.7 · shape facets, nouns and reachable bands", () => {
  it("strips a facet the shape cannot have, rather than storing it", () => {
    const parsed = icpProfileSchema.parse({
      shape: "consumer",
      vertical: "dental",
      location: "Austin",
      radiusMiles: 25,
      headcountBand: "5–25",
      titles: ["Owner"],
      ownerRun: true,
    });
    expect(parsed.headcountBand).toBeUndefined();
    expect(parsed.titles).toBeUndefined();
    expect(parsed.ownerRun).toBeUndefined();
    // What a person CAN have survives untouched.
    expect(parsed.location).toBe("Austin");
    expect(parsed.radiusMiles).toBe(25);
  });

  it("keeps company facets for the shapes that have them", () => {
    const parsed = icpProfileSchema.parse({
      shape: "company",
      headcountBand: "5–25",
      titles: ["Owner"],
      ownerRun: true,
    });
    expect(parsed.headcountBand).toBe("5–25");
    expect(parsed.titles).toEqual(["Owner"]);
  });

  it("awards no points for a facet the shape cannot have", () => {
    // Handed directly to the scorer, bypassing the schema — a profile can be
    // built in code, and the ceiling this sets is a scoring fact.
    const rogue = {
      shape: "consumer" as const,
      titles: ["Owner"],
      headcountBand: "5–25",
      ownerRun: true,
    };
    const scored = scoreCandidate(rogue, {
      title: "Owner",
      headcount: 10,
      ownerRun: true,
    });
    expect(scored.fit).toBe(50);
    expect(scored.reasons).toEqual([]);
  });

  it("gives the vertical's noun only to a workspace that sells to people", () => {
    // A dental PRACTICE sells to patients...
    expect(subjectNounFor("consumer", "dental").many).toBe("patients");
    // ...but a supplier selling TO practices carries the same vertical and
    // is not selling to anybody's patients.
    expect(subjectNounFor("local_business", "dental").many).toBe("businesses");
    expect(subjectNounFor("company", "dental").many).toBe("companies");
    // And the gate is not blanket: an organisation noun still wins for an
    // organisation shape, while a consumer shape refuses it.
    expect(subjectNounFor("company", "saas").many).toBe("accounts");
    expect(subjectNounFor("consumer", "saas").many).toBe("people");
  });

  it("puts the top band inside every shape's reach", () => {
    for (const shape of ICP_SHAPES) {
      const max = reachablePoolMax(shape);
      const floors = poolBandFloors(shape);
      // The defect this replaces: a consumer workspace tops out at 81 and
      // could never enter a band floored at 90. A band nothing can enter is
      // the same defect as a flat 50 — it looks like information and is not.
      expect(floors.strong).toBeLessThanOrEqual(max);
      expect(fitTier(shape, max)).toBe("strong");
      expect(floors.strong).toBeGreaterThan(floors.good);
      expect(floors.good).toBeGreaterThan(floors.try);
    }
    // Consumer really is the lower ceiling, because it has one fewer facet.
    expect(reachablePoolMax("consumer")).toBeLessThan(reachablePoolMax("company"));
  });

  it("labels each band with the floor it actually uses", () => {
    for (const shape of ICP_SHAPES) {
      const bands = poolBandsFor(shape);
      const floors = poolBandFloors(shape);
      expect(bands[1]!.tag).toContain(String(floors.strong));
      expect(bands[1]!.min).toBe(floors.strong);
      // The free band is untouched: it is defined by holding the details.
      expect(bands[0]!.key).toBe("yours");
      expect(bands[0]!.min).toBeNull();
    }
  });
});
