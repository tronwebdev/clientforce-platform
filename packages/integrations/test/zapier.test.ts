/**
 * INT W5 (DEC-101) — the Zapier surface is DERIVED, and these pin that it stays
 * derived. The failure this guards against is a hand-maintained parallel list
 * drifting from the product's vocabulary: a capability that ships in the app
 * but not the engine, or (worse) a registered capability the app silently never
 * offers because nobody remembered to add it.
 *
 * The load-bearing guarantee is a COMPILE error, not a runtime assertion —
 * `ZAPIER_ACTION_EXPOSURE` is a non-Partial Record over `CampaignRuleActionKind`,
 * so a new kind fails `tsc` before any test runs. These tests pin the parts a
 * type cannot state: that every decision is REACHABLE and MEANINGFUL (a decline
 * carries a reason), that keys are unique and stable, and that nothing absent
 * from the registries leaks into the manifest.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_KINDS,
  campaignRuleActionSchema,
  ZAPIER_INBOUND_WRITE_KINDS,
  zapierInboundWriteSchemas,
  type CampaignRuleActionKind,
} from "@clientforce/core";
import { EVENT_SCHEMAS } from "@clientforce/events";
import {
  buildZapierManifest,
  isZapierTriggerKey,
  ZAPIER_ACTION_EXPOSURE,
  ZAPIER_EXPOSED_ACTIONS,
  ZAPIER_TRIGGER_EVENT_TYPES,
  ZAPIER_TRIGGER_KEYS,
  ZAPIER_TRIGGERS,
} from "../src/zapier";

/** The engine's kinds, read off the schema itself — the one source of truth. */
const SCHEMA_ACTION_KINDS = campaignRuleActionSchema.options.map(
  (o) => o.shape.kind.value,
) as CampaignRuleActionKind[];

describe("Zapier action exposure (derived from the rule-action registry)", () => {
  it("carries a decision for EXACTLY the engine's action kinds — no more, no fewer", () => {
    // Set equality both ways: an extra key here would be a Zapier step with no
    // engine action behind it; a missing one is caught by tsc, and this states
    // the same invariant at runtime so the intent survives a refactor.
    expect(new Set(Object.keys(ZAPIER_ACTION_EXPOSURE))).toEqual(new Set(SCHEMA_ACTION_KINDS));
    expect(Object.keys(ZAPIER_ACTION_EXPOSURE)).toHaveLength(SCHEMA_ACTION_KINDS.length);
  });

  it("every DECLINED kind states why — a decision without a reason is an omission", () => {
    for (const [kind, spec] of Object.entries(ZAPIER_ACTION_EXPOSURE)) {
      if (!spec.exposed) {
        expect(spec.reason.length, `${kind} declined with no reason`).toBeGreaterThan(20);
      }
    }
  });

  it("every EXPOSED kind carries a key, a label and help", () => {
    for (const a of ZAPIER_EXPOSED_ACTIONS) {
      expect(a.key, `${a.kind} key`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(a.label.length).toBeGreaterThan(2);
      expect(a.help.length).toBeGreaterThan(10);
    }
  });

  it("exposed keys are unique — a collision would silently shadow a step", () => {
    const keys = ZAPIER_EXPOSED_ACTIONS.map((a) => a.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it("never exposes a kind the engine refuses at account scope", () => {
    // move_to_node is campaign-graph scoped; an account-scope caller (which is
    // what a Zap is) could only ever pass a dangling node id.
    for (const a of ZAPIER_EXPOSED_ACTIONS) {
      expect(ACCOUNT_ACTION_KINDS as readonly string[]).toContain(a.kind);
    }
  });

  it("SENDS stay out — the boundary rail holds through Zapier too (Q-039, Q-057)", () => {
    // The two link kinds are exposed as FLAGS and must never be labelled as
    // sends: shipping "send" wording over a flag would mislead every Zapier
    // user who picks it, which is exactly why the flag-twin was rejected as a
    // stand-in for send-to-channel.
    const flags = ZAPIER_EXPOSED_ACTIONS.filter((a) =>
      ["send_booking_link", "send_payment_link"].includes(a.kind),
    );
    expect(flags).toHaveLength(2);
    for (const f of flags) {
      expect(f.key.startsWith("flag_"), `${f.kind} key should read as a flag`).toBe(true);
      expect(f.label.toLowerCase()).not.toMatch(/^send\b/);
      expect(f.help).toMatch(/does NOT send/i);
    }
    // And no step anywhere in the manifest claims to send to a channel.
    const manifest = buildZapierManifest();
    for (const c of manifest.creates) {
      expect(c.key).not.toMatch(/send_to_channel|send_email|send_sms|send_whatsapp/);
    }
  });
});

describe("Zapier inbound writes (their own registry, pinned the same way)", () => {
  it("every write kind has a payload contract", () => {
    expect(new Set(Object.keys(zapierInboundWriteSchemas))).toEqual(
      new Set(ZAPIER_INBOUND_WRITE_KINDS),
    );
  });

  it("a contact write demands an email or a phone — an unreachable row is refused", () => {
    const create = zapierInboundWriteSchemas.create_contact!;
    expect(create.safeParse({ firstName: "Ada" }).success).toBe(false);
    expect(create.safeParse({ email: "ada@example.com" }).success).toBe(true);
    expect(create.safeParse({ phone: "+15550001111" }).success).toBe(true);
  });

  it("write payloads are STRICT — an unknown field is refused, never dropped silently", () => {
    // A Zap mapping a field we do not store should fail loudly at the boundary
    // rather than appear to work while discarding the value.
    const create = zapierInboundWriteSchemas.create_contact!;
    expect(create.safeParse({ email: "a@example.com", notAField: "x" }).success).toBe(false);
  });

  it("enrolment needs a campaign and an identity", () => {
    const enroll = zapierInboundWriteSchemas.enroll_in_campaign!;
    expect(enroll.safeParse({ campaignId: "c1" }).success).toBe(false);
    expect(enroll.safeParse({ campaignId: "c1", email: "a@example.com" }).success).toBe(true);
  });
});

describe("Zapier triggers (derived over the event catalog)", () => {
  it("every trigger key has a spec, and every spec names REAL catalog events", () => {
    expect(new Set(Object.keys(ZAPIER_TRIGGERS))).toEqual(new Set(ZAPIER_TRIGGER_KEYS));
    for (const key of ZAPIER_TRIGGER_KEYS) {
      const spec = ZAPIER_TRIGGERS[key];
      expect(spec.eventTypes.length).toBeGreaterThan(0);
      for (const t of spec.eventTypes) {
        // The type system already pins this; asserting it too means a catalog
        // rename cannot leave a trigger pointing at a type that stopped existing.
        expect(Object.keys(EVENT_SCHEMAS)).toContain(t);
      }
    }
  });

  it("the reply trigger covers every reply channel — one Zap, all channels", () => {
    expect(new Set(ZAPIER_TRIGGERS.reply_received.eventTypes)).toEqual(
      new Set(["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"]),
    );
  });

  it("the knowledge-gap trigger fires on a GAP, not on every retrieval", () => {
    // Mirrors the rule matcher: the event publishes for every lookup, so the
    // trigger must apply the same predicate or a Zap and a rule would disagree
    // about whether a gap happened.
    const spec = ZAPIER_TRIGGERS.call_knowledge_gap;
    expect(spec.matches).toBeTypeOf("function");
    expect(spec.matches!({ emptyFacets: ["knowledge"] })).toBe(true);
    expect(spec.matches!({ emptyFacets: [] })).toBe(false);
    expect(spec.matches!({})).toBe(false);
  });

  it("names the enrolment trigger after what it can actually prove (Q-058)", () => {
    // The dispatch asked for "campaign launched"; no campaign-lifecycle event
    // exists, so the trigger is named for the per-contact emission it really
    // reads. Naming it "campaign launched" would promise a payload we cannot
    // produce.
    expect(ZAPIER_TRIGGERS.contact_enrolled.eventTypes).toEqual(["lead.enrolled.v1"]);
    expect(ZAPIER_TRIGGERS.contact_enrolled.label).toMatch(/enrolled/i);
    for (const key of ZAPIER_TRIGGER_KEYS) {
      expect(ZAPIER_TRIGGERS[key].label.toLowerCase()).not.toContain("campaign launched");
    }
  });

  it("the poll filter is the de-duplicated union of every trigger's events", () => {
    const all = Object.values(ZAPIER_TRIGGERS).flatMap((t) => [...t.eventTypes]);
    expect(new Set(ZAPIER_TRIGGER_EVENT_TYPES)).toEqual(new Set(all));
    expect(ZAPIER_TRIGGER_EVENT_TYPES).toHaveLength(new Set(all).size);
  });

  it("isZapierTriggerKey guards the rail", () => {
    expect(isZapierTriggerKey("meeting_booked")).toBe(true);
    expect(isZapierTriggerKey("not_a_trigger")).toBe(false);
  });
});

describe("the manifest is built by enumeration, never hand-listed", () => {
  it("renders exactly the derived surface, with each step's origin declared", () => {
    const m = buildZapierManifest();
    expect(m.triggers.map((t) => t.key)).toEqual([...ZAPIER_TRIGGER_KEYS]);
    expect(m.creates.filter((c) => c.origin === "inbound_write").map((c) => c.key)).toEqual([
      ...ZAPIER_INBOUND_WRITE_KINDS,
    ]);
    expect(m.creates.filter((c) => c.origin === "rule_action").map((c) => c.key)).toEqual(
      ZAPIER_EXPOSED_ACTIONS.map((a) => a.key),
    );
  });

  it("offers nothing for a capability that does not exist yet (forms, proposals)", () => {
    // Forms and proposals have MODELS but no registered action kinds, so they
    // must not appear — and they will appear automatically, with no edit to the
    // Zapier app, on the day someone registers them.
    const m = buildZapierManifest();
    const surface = JSON.stringify(m).toLowerCase();
    expect(surface).not.toContain("proposal");
    expect(surface).not.toContain("form submission");
  });

  it("every manifest key is unique across BOTH registries", () => {
    // The two registries are pinned separately, so only this can catch an
    // inbound write and a rule action colliding on one Zapier key.
    const keys = buildZapierManifest().creates.map((c) => c.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });
});
