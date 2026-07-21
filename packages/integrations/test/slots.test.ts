/**
 * INT W2 (DEC-094): pure slot derivation — deterministic, timezone-correct
 * via Intl, DST edges pinned. No DB, no network.
 */
import { describe, expect, it } from "vitest";
import { deriveSlots, formatSlotsLine } from "../src/slots";

// Monday 2026-07-20 12:00 UTC.
const NOW = new Date("2026-07-20T12:00:00Z");

describe("deriveSlots", () => {
  it("offers at most one slot per local day, weekdays only, inside 9–17 local hours", () => {
    const slots = deriveSlots([], NOW, "UTC", { maxSlots: 3 });
    expect(slots).toHaveLength(3);
    const days = new Set<string>();
    for (const slot of slots) {
      const day = slot.toISOString().slice(0, 10);
      expect(days.has(day)).toBe(false);
      days.add(day);
      const dow = slot.getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
      const mins = slot.getUTCHours() * 60 + slot.getUTCMinutes();
      expect(mins).toBeGreaterThanOrEqual(9 * 60);
      expect(mins + 30).toBeLessThanOrEqual(17 * 60);
    }
  });

  it("respects the 24h lead time (nothing today) and skips the weekend", () => {
    // Friday 12:00 UTC + 24h lead = Saturday — the first offer must be Monday.
    const friday = new Date("2026-07-24T12:00:00Z");
    const slots = deriveSlots([], friday, "UTC", { maxSlots: 1 });
    expect(slots[0]?.toISOString().slice(0, 10)).toBe("2026-07-27"); // Monday
  });

  it("avoids busy ranges (overlap at either edge collides)", () => {
    // Tuesday fully busy 09:00–17:00 UTC → the Tue slot moves past the block
    // or the day is skipped entirely.
    const busy = [{ start: "2026-07-21T09:00:00Z", end: "2026-07-21T17:00:00Z" }];
    const slots = deriveSlots(busy, NOW, "UTC", { maxSlots: 3 });
    for (const slot of slots) {
      const end = slot.getTime() + 30 * 60_000;
      expect(slot.getTime() >= Date.parse("2026-07-21T17:00:00Z") || end <= Date.parse("2026-07-21T09:00:00Z") || slot.toISOString().slice(0, 10) !== "2026-07-21").toBe(true);
    }
    expect(slots.some((s) => s.toISOString().slice(0, 10) === "2026-07-21")).toBe(false);
  });

  it("projects business hours into the CALENDAR's timezone, not UTC", () => {
    const slots = deriveSlots([], NOW, "America/Chicago", { maxSlots: 2 });
    for (const slot of slots) {
      const local = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(slot);
      const hour = Number.parseInt(local.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      // 9 AM Chicago (CDT, UTC-5) is 14:00 UTC — a 9 AM UTC instant would be
      // 4 AM local and must never appear.
      expect(slot.getUTCHours()).toBeGreaterThanOrEqual(14);
    }
  });

  it("stays local-time-correct across the US DST fall-back edge (Nov 1 2026)", () => {
    // Friday 2026-10-30 12:00 UTC; DST ends Sunday Nov 1. Offers land Mon/Tue
    // AFTER the transition and must still be 9–17 LOCAL (CST, UTC-6).
    const beforeDst = new Date("2026-10-30T12:00:00Z");
    const slots = deriveSlots([], beforeDst, "America/Chicago", { maxSlots: 2 });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(slot);
      const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
    }
  });

  it("is deterministic — same inputs, same output", () => {
    const a = deriveSlots([{ start: "2026-07-21T14:00:00Z", end: "2026-07-21T15:00:00Z" }], NOW, "Europe/Berlin");
    const b = deriveSlots([{ start: "2026-07-21T14:00:00Z", end: "2026-07-21T15:00:00Z" }], NOW, "Europe/Berlin");
    expect(a.map((d) => d.toISOString())).toEqual(b.map((d) => d.toISOString()));
  });

  it("ignores malformed busy entries instead of throwing", () => {
    const slots = deriveSlots([{ start: "garbage", end: "also-garbage" }], NOW, "UTC", { maxSlots: 1 });
    expect(slots).toHaveLength(1);
  });
});

describe("formatSlotsLine", () => {
  it("renders the deterministic owner-readable line and nulls on empty", () => {
    const line = formatSlotsLine(
      [new Date("2026-07-21T15:00:00Z"), new Date("2026-07-22T19:30:00Z")],
      "America/Chicago",
    );
    expect(line).toBe("Open times (America/Chicago): Tue 10:00 AM · Wed 2:30 PM");
    expect(formatSlotsLine([], "America/Chicago")).toBeNull();
  });
});
