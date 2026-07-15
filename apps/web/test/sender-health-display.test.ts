/**
 * P5 W2 (DEC-084): the Settings surface renders the ENGINE's bands — ring
 * states, list pills, warm-up pill, and the activity copy map all pinned
 * against the same `@clientforce/core` cutoffs the boundary enforces (the
 * surface and the engine agree by construction; drift here is a red build).
 */
import { describe, expect, it } from "vitest";
import { HEALTH_BANDS } from "@clientforce/core";
import {
  describeSenderEvent,
  ringDisplay,
  sendingPill,
  warmupPill,
} from "../app/(shell)/settings/health-display";
import type { Sender, SenderHealth, SenderWarmup } from "../app/(shell)/settings/shared";

const health = (over: Partial<SenderHealth> = {}): SenderHealth => ({
  score: 95,
  state: "healthy",
  band: "healthy",
  floor: "ok",
  windowDays: 7,
  computedAt: "2026-07-15T12:00:00.000Z",
  sample: { sent: 100, delivered: 98, bounced: 0, spam: 0, replied: 2 },
  rates: { bounce: 0, spam: 0, delivery: 0.98, reply: 0.02 },
  ...over,
});
const warmup = (over: Partial<SenderWarmup> = {}): SenderWarmup => ({
  active: true,
  day: 5,
  days: 45,
  currentCap: 100,
  target: 500,
  pct: 11,
  holding: false,
  startedAt: "2026-07-11T00:00:00.000Z",
  ...over,
});
const sender = (over: Partial<Sender> = {}): Sender =>
  ({
    id: "s1",
    type: "CF_MANAGED",
    fromEmail: "a@send.x.io",
    fromName: "A",
    status: "ACTIVE",
    domainAuthStatus: {},
    dailyLimit: 500,
    sentToday: 0,
    warmupState: null,
    dedicatedIp: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    health: null,
    warmup: null,
    ...over,
  }) as Sender;

describe("ringDisplay — the locked bands fold into the ring", () => {
  it("locked cutoffs are the core contract (engine + surface share it)", () => {
    expect(HEALTH_BANDS).toEqual({ healthy: 80, watch: 60, atRisk: 40 });
  });

  it("healthy band keeps the prototype vocabulary: Excellent ≥90, Good 80–89, green", () => {
    expect(ringDisplay(health({ score: 98 }))).toMatchObject({ score: "98", color: "#16A82A", label: "Excellent" });
    expect(ringDisplay(health({ score: 85, band: "healthy" }))).toMatchObject({ label: "Good", color: "#16A82A" });
    expect(ringDisplay(health({ score: 80, band: "healthy" }))).toMatchObject({ label: "Good" });
  });

  it("watch (60–79) amber · at-risk (40–59) deep amber · auto-paused (<40) red", () => {
    expect(ringDisplay(health({ score: 79, band: "watch" }))).toMatchObject({ label: "Watch", color: "#E8C45B" });
    expect(ringDisplay(health({ score: 59, band: "at_risk" }))).toMatchObject({ label: "At risk", color: "#A87B16" });
    expect(ringDisplay(health({ score: 39, band: "paused", state: "unhealthy" }))).toMatchObject({
      label: "Auto-paused",
      color: "#C9543F",
    });
  });

  it("below the floor: em-dash, never a number — 'Warming up · low data'", () => {
    const r = ringDisplay(health({ score: null, state: "low_data", band: null, floor: "none", rates: null }));
    expect(r.score).toBe("—");
    expect(r.label).toBe("Warming up");
    expect(r.sub).toContain("low data");
    expect(ringDisplay(null)).toMatchObject({ score: "—", label: "Warming up" });
  });

  it("band falls back to the score when a snapshot predates the band field", () => {
    expect(ringDisplay(health({ score: 65, band: null }))).toMatchObject({ label: "Watch" });
  });
});

describe("sendingPill — status ▸ gate ▸ ramp ▸ Good", () => {
  it("owner status wins: DISABLED then PAUSED", () => {
    expect(sendingPill(sender({ status: "DISABLED" })).label).toBe("Needs verification");
    expect(sendingPill(sender({ status: "PAUSED", health: health({ score: 10, band: "paused", state: "unhealthy" }) })).label).toBe("Paused");
  });
  it("the health gate shows as Auto-paused", () => {
    expect(sendingPill(sender({ health: health({ score: 12, band: "paused", state: "unhealthy" }) })).label).toBe("Auto-paused");
  });
  it("an active ramp shows the canon 'Warming'; clean senders are 'Good'", () => {
    expect(sendingPill(sender({ warmup: warmup() })).label).toBe("Warming");
    expect(sendingPill(sender({ health: health() })).label).toBe("Good");
    expect(sendingPill(sender()).label).toBe("Good");
  });
});

describe("warmupPill — Active / Held / Complete", () => {
  it("maps the projection states", () => {
    expect(warmupPill(warmup()).label).toBe("Active");
    expect(warmupPill(warmup({ holding: true })).label).toBe("Held");
    expect(warmupPill(warmup({ active: false, completedAt: "2026-08-25T00:00:00.000Z" })).label).toBe("Complete");
  });
});

describe("describeSenderEvent — mapped types only (DEC-057, no raw slugs)", () => {
  it("covers every sender.* catalog event this unit emits", () => {
    expect(describeSenderEvent("sender.health_collapsed.v1", { score: 12 })?.text).toContain("collapsed to 12/100");
    expect(describeSenderEvent("sender.health_recovered.v1", { score: 88 })?.text).toContain("recovered to 88/100");
    expect(describeSenderEvent("sender.health_recovered.v1", { lowData: true })?.text).toContain("Quiet window");
    expect(describeSenderEvent("sender.warmup_completed.v1", { days: 45 })?.text).toContain("day 45");
    expect(describeSenderEvent("sender.status_changed.v1", { from: "ACTIVE", to: "PAUSED" })?.text).toBe("Sender paused");
    expect(describeSenderEvent("sender.status_changed.v1", { from: "PAUSED", to: "ACTIVE" })?.text).toBe("Sender resumed");
  });
  it("unmapped types render NOTHING (never a raw slug)", () => {
    expect(describeSenderEvent("email.bounced.v1", {})).toBeNull();
  });
});
