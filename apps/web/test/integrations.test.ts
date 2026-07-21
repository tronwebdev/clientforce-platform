/**
 * INT W1-UI: the Integrations display registry + Slack drawer maps + honest
 * status display. The load-bearing pins:
 *   — the LIVE set is exactly core `INTEGRATION_PROVIDERS` (set equality both
 *     ways — the picker↔vocabulary drift-test pattern; availability is DERIVED
 *     from core, so a new wave flips its card live with zero registry edits)
 *   — the canon totals hold (15 cards, the 6 canon categories) and the
 *     honest-absent ledger stays honest (every absent entry carries a reason;
 *     no absent entry shadows a live provider)
 *   — the "What's syncing" rows are core `SLACK_NOTIFICATION_KINDS` verbatim
 *   — ONLY `connected` renders "Live · Connected"; the revoked copy names the
 *     reconnect repair (probe-backed honesty, never inferred)
 */
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
  SLACK_NOTIFICATION_KINDS,
  type SlackNotificationKind,
} from "@clientforce/core";
import {
  CATEGORY_LABELS,
  DRAWER_CONTENT,
  INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  MANAGED_TWILIO_HREF,
  SLACK_NOTIFICATION_LABELS,
  TILE,
  catalogEntry,
  healthLine,
  notificationOn,
  parseSlackConfig,
  slackConfigPayload,
  statusPill,
} from "../lib/integrations";
import { mergeActivity } from "../app/(shell)/integrations/IntegrationDrawer";

describe("registry drift (lib/integrations vs @clientforce/core)", () => {
  it("the LIVE set equals core INTEGRATION_PROVIDERS — set equality both ways", () => {
    const live = INTEGRATION_CATALOG.filter((e) => e.availability.kind === "live").map((e) => e.id);
    expect(new Set(live)).toEqual(new Set(INTEGRATION_PROVIDERS));
    // Every core provider has a canon card to surface on (no orphan adapter).
    for (const p of INTEGRATION_PROVIDERS) {
      expect(catalogEntry(p), `core provider "${p}" needs a catalog card`).not.toBeNull();
    }
  });

  it("the canon total is 15, ids unique, every entry carries the full card anatomy", () => {
    expect(INTEGRATION_CATALOG).toHaveLength(15);
    expect(new Set(INTEGRATION_CATALOG.map((e) => e.id)).size).toBe(15);
    for (const e of INTEGRATION_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.glyph.length).toBeGreaterThan(0);
      expect(e.desc.length).toBeGreaterThan(0);
      expect(Object.keys(TILE)).toContain(e.tile);
    }
  });

  it("every absent entry carries a non-empty owner-readable reason", () => {
    for (const e of INTEGRATION_CATALOG) {
      if (e.availability.kind === "absent") {
        expect(e.availability.reason.length, `absent "${e.id}" needs a reason`).toBeGreaterThan(0);
      }
    }
  });

  it("no absent entry shadows a live provider (id or display name)", () => {
    const live = INTEGRATION_CATALOG.filter((e) => e.availability.kind === "live");
    const absent = INTEGRATION_CATALOG.filter((e) => e.availability.kind === "absent");
    const liveIds = new Set(live.map((e) => e.id));
    const liveNames = new Set(live.map((e) => e.name));
    for (const a of absent) {
      expect(liveIds.has(a.id)).toBe(false);
      expect(liveNames.has(a.name)).toBe(false);
    }
  });

  it("the category set is exactly the canon 6", () => {
    expect(INTEGRATION_CATEGORIES).toHaveLength(6);
    expect(new Set(Object.keys(CATEGORY_LABELS))).toEqual(new Set(INTEGRATION_CATEGORIES));
    expect(new Set(INTEGRATION_CATALOG.map((e) => e.cat))).toEqual(new Set(INTEGRATION_CATEGORIES));
  });

  it("twilio is MANAGED (the real SMS channel lives in Settings) — never a fake Connect", () => {
    const twilio = catalogEntry("twilio");
    expect(twilio?.availability.kind).toBe("managed");
    if (twilio?.availability.kind === "managed") {
      expect(twilio.availability.href).toBe(MANAGED_TWILIO_HREF);
      expect(twilio.availability.note.length).toBeGreaterThan(0);
    }
  });
});

describe("per-provider drawer content (DRAWER_CONTENT, drift-guarded against core)", () => {
  it("DRAWER_CONTENT covers exactly the core provider union — set equality (runtime drift pin)", () => {
    // The compile-time pin is the NON-Partial Record satisfies; this holds the
    // same contract at runtime so a cast can never smuggle a gap through.
    expect(new Set(Object.keys(DRAWER_CONTENT))).toEqual(new Set(INTEGRATION_PROVIDERS));
  });

  it("the slack what's-syncing rows are SLACK_NOTIFICATION_KINDS exactly, in order", () => {
    expect(DRAWER_CONTENT.slack.syncRows.map((r) => r.kind)).toEqual([...SLACK_NOTIFICATION_KINDS]);
    expect(new Set(Object.keys(SLACK_NOTIFICATION_LABELS))).toEqual(new Set(SLACK_NOTIFICATION_KINDS));
    const labels = DRAWER_CONTENT.slack.syncRows.map((r) => r.label);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("the slack auth-step perms list is the dispatch-locked pair", () => {
    expect(DRAWER_CONTENT.slack.authPerms).toEqual([
      "Post alerts to the channel you pick",
      "See your public channel list",
    ]);
  });

  it("the slack setup timeline has three steps with copy, and the picker fetches channels", () => {
    expect(DRAWER_CONTENT.slack.setupSteps).toHaveLength(3);
    for (const s of DRAWER_CONTENT.slack.setupSteps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.desc.length).toBeGreaterThan(0);
    }
    expect(DRAWER_CONTENT.slack.optionsKind).toBe("channels");
  });
});

describe("honest status display (probe-backed vocabulary → pill copy)", () => {
  it("every core status yields a pill (drift guard)", () => {
    for (const s of INTEGRATION_STATUSES) {
      expect(statusPill(s, "Slack").label.length).toBeGreaterThan(0);
      expect(healthLine(s).text.length).toBeGreaterThan(0);
    }
  });

  it("ONLY connected renders 'Live · Connected' (and the pulse dot)", () => {
    expect(statusPill("connected", "Slack").label).toBe("Live · Connected");
    expect(statusPill("connected", "Slack").pulse).toBe(true);
    for (const s of INTEGRATION_STATUSES.filter((x) => x !== "connected")) {
      expect(statusPill(s, "Slack").label).not.toBe("Live · Connected");
      expect(statusPill(s, "Slack").pulse).toBe(false);
    }
  });

  it("unhealthy says so; revoked names the reconnect repair", () => {
    expect(statusPill("unhealthy", "Slack").label).toBe(
      "Connection unhealthy — Slack unreachable at the last probe",
    );
    expect(statusPill("revoked", "Slack").label).toBe(
      "Disconnected — Slack revoked this token. Reconnect to resume.",
    );
    expect(statusPill("revoked", "Slack").label).toMatch(/Reconnect/);
  });
});

describe("Slack config helpers (full-payload-preserving PATCH bodies)", () => {
  it("parseSlackConfig: null/garbage → {}, valid config round-trips", () => {
    expect(parseSlackConfig(null)).toEqual({});
    expect(parseSlackConfig(undefined)).toEqual({});
    expect(parseSlackConfig({ channel: { id: "", name: "" } })).toEqual({});
    expect(parseSlackConfig("nope")).toEqual({});
    const cfg = { channel: { id: "C1", name: "alerts" }, notifications: { new_reply: false } };
    expect(parseSlackConfig(cfg)).toEqual(cfg);
  });

  it("notificationOn: absent = ON, explicit false = OFF", () => {
    expect(notificationOn({}, "new_reply")).toBe(true);
    expect(notificationOn({ notifications: {} }, "meeting_booked")).toBe(true);
    expect(notificationOn({ notifications: { new_reply: false } }, "new_reply")).toBe(false);
    expect(notificationOn({ notifications: { new_reply: false } }, "goal_completed")).toBe(true);
  });

  it("slackConfigPayload makes every kind explicit and preserves the channel across a toggle", () => {
    const cfg = { channel: { id: "C1", name: "alerts" }, notifications: { meeting_booked: false } };
    const out = slackConfigPayload(cfg, { notifications: { new_reply: false } });
    expect(out.channel).toEqual({ id: "C1", name: "alerts" });
    expect(out.notifications).toEqual({ new_reply: false, meeting_booked: false, goal_completed: true });
  });

  it("slackConfigPayload: channel change preserves the notification state", () => {
    const cfg = { notifications: { goal_completed: false } };
    const out = slackConfigPayload(cfg, { channel: { id: "C9", name: "growth" } });
    expect(out.channel).toEqual({ id: "C9", name: "growth" });
    expect(out.notifications).toEqual({ new_reply: true, meeting_booked: true, goal_completed: false });
  });

  it("slackConfigPayload with no channel anywhere omits the channel key", () => {
    const out = slackConfigPayload({});
    expect("channel" in out).toBe(false);
    expect(out.notifications).toEqual({ new_reply: true, meeting_booked: true, goal_completed: true });
  });

  it("a drawer draft seeded from a stored config with goal_completed:false round-trips false through the payload builder", () => {
    // The post-OAuth re-seed path (IntegrationDrawer): the row lands after a
    // null-row mount, the draft re-seeds from the REAL stored config, and the
    // wizard's "Finish & connect" builds its PATCH from that draft — a stored
    // opt-out must survive the round-trip, never be clobbered back to ON.
    const stored = parseSlackConfig({
      channel: { id: "C7", name: "wins" },
      notifications: { goal_completed: false },
    });
    // Exactly the drawer's seed: one toggle per sync row, ON unless explicitly false.
    const toggles = Object.fromEntries(
      DRAWER_CONTENT.slack.syncRows.map((r) => [r.kind, notificationOn(stored, r.kind)]),
    ) as Record<SlackNotificationKind, boolean>;
    expect(toggles).toEqual({ new_reply: true, meeting_booked: true, goal_completed: false });
    // Exactly the drawer's saveConfig: channel included only when the draft has one.
    const payload = slackConfigPayload(stored, {
      ...(stored.channel ? { channel: stored.channel } : {}),
      notifications: toggles,
    });
    expect(payload).toEqual({
      channel: { id: "C7", name: "wins" },
      notifications: { new_reply: true, meeting_booked: true, goal_completed: false },
    });
  });
});

describe("activity merge (the drawer audit trail — designed addition)", () => {
  it("merges deliveries + events newest first, verbatim text, honest tones", () => {
    const items = mergeActivity(
      [
        { id: "1", kind: "slack.message", status: "sent", detail: null, createdAt: "2026-07-21T10:00:00.000Z" },
        { id: "2", kind: "slack.message", status: "failed", detail: "channel_not_found", createdAt: "2026-07-21T12:00:00.000Z" },
      ],
      [{ id: "3", type: "integration.connected.v1", payload: {}, occurredAt: "2026-07-21T11:00:00.000Z" }],
    );
    expect(items.map((i) => i.id)).toEqual(["d-2", "e-3", "d-1"]);
    expect(items[0]!.text).toBe("slack.message — failed");
    expect(items[0]!.sub).toBe("channel_not_found");
    expect(items[0]!.tone).toBe("bad");
    expect(items[1]!.text).toBe("integration.connected.v1");
    expect(items[1]!.tone).toBe("neutral");
    expect(items[2]!.tone).toBe("ok");
  });

  it("empty in → empty out (the honest 'No activity yet' path)", () => {
    expect(mergeActivity([], [])).toEqual([]);
  });
});
