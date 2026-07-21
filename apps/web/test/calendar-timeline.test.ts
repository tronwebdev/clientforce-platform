/**
 * INT W2 (DEC-094): the calendar.* timeline surfaces — the load-bearing pins:
 *   — the lead-drawer EVENT_ROW map gains the three calendar rows with the
 *     mandated tones (booked GREEN · canceled RED · rescheduled NEUTRAL) and
 *     copy that renders the payload's meeting time LOCAL (degrading to
 *     timeless copy on absent/garbage payloads — never "Invalid Date")
 *   — the Inbox reading pane's system-row helper (a designed addition,
 *     flagged in InboxTab) renders ONLY calendar.* types — every other event
 *     type returns null and can never leak into the thread as a bubble
 *   — meetingTime is total: garbage in → null out
 */
import { describe, expect, it } from "vitest";
import { EVENT_ROW } from "../app/(shell)/agents/[agentId]/[tab]/LeadsTab";
import { calendarSystemRow } from "../app/(shell)/agents/[agentId]/[tab]/InboxTab";
import { meetingTime } from "../app/(shell)/agents/[agentId]/[tab]/shared";

const START = "2026-07-28T15:00:00.000Z";
const TO = "2026-07-30T16:30:00.000Z";

describe("meetingTime (shared) — total, local, never Invalid Date", () => {
  it("renders a non-empty local string for a valid ISO stamp", () => {
    const t = meetingTime(START);
    expect(typeof t).toBe("string");
    expect((t as string).length).toBeGreaterThan(0);
    expect(t).not.toContain("Invalid");
  });

  it("garbage in → null out (absent, non-string, unparseable)", () => {
    expect(meetingTime(undefined)).toBeNull();
    expect(meetingTime(null)).toBeNull();
    expect(meetingTime(42)).toBeNull();
    expect(meetingTime("")).toBeNull();
    expect(meetingTime("not-a-date")).toBeNull();
  });
});

describe("lead-drawer EVENT_ROW calendar rows (LeadsTab)", () => {
  it("covers the three calendar.* types with the mandated tones", () => {
    expect(EVENT_ROW["calendar.booked.v1"]).toBeDefined();
    expect(EVENT_ROW["calendar.rescheduled.v1"]).toBeDefined();
    expect(EVENT_ROW["calendar.canceled.v1"]).toBeDefined();
    // booked = green ✦-family · canceled = red · rescheduled = neutral.
    expect(EVENT_ROW["calendar.booked.v1"]!.fg).toBe("#16A82A");
    expect(EVENT_ROW["calendar.canceled.v1"]!.fg).toBe("#C9543F");
    expect(EVENT_ROW["calendar.rescheduled.v1"]!.fg).toBe("#8A7F6B");
    expect(EVENT_ROW["calendar.booked.v1"]!.icon).toBe("📅");
  });

  it("booked copy carries the LOCAL start time from the payload; timeless without one", () => {
    const label = EVENT_ROW["calendar.booked.v1"]!.label({ startAt: START });
    expect(label).toMatch(/^Meeting booked — .+/);
    expect(label).toContain(meetingTime(START) as string);
    expect(EVENT_ROW["calendar.booked.v1"]!.label({})).toBe("Meeting booked");
  });

  it("rescheduled copy renders the NEW time (toStartAt); canceled folds the no_show reason", () => {
    const moved = EVENT_ROW["calendar.rescheduled.v1"]!.label({ fromStartAt: START, toStartAt: TO });
    expect(moved).toMatch(/^Meeting rescheduled — now .+/);
    expect(moved).toContain(meetingTime(TO) as string);
    expect(EVENT_ROW["calendar.rescheduled.v1"]!.label({})).toBe("Meeting rescheduled");
    expect(EVENT_ROW["calendar.canceled.v1"]!.label({ startAt: START, reason: "canceled" })).toMatch(
      /^Meeting canceled — was .+/,
    );
    expect(EVENT_ROW["calendar.canceled.v1"]!.label({ reason: "no_show" })).toBe("Meeting no-show");
  });
});

describe("Inbox thread system rows (InboxTab.calendarSystemRow — designed addition)", () => {
  it("booked → green centered row with the 📅 copy", () => {
    const row = calendarSystemRow("calendar.booked.v1", { startAt: START });
    expect(row).not.toBeNull();
    expect(row!.text).toMatch(/^📅 Meeting booked — .+/);
    expect(row!.fg).toBe("#16A82A");
  });

  it("rescheduled → neutral; canceled → red (no_show says so)", () => {
    const moved = calendarSystemRow("calendar.rescheduled.v1", { toStartAt: TO });
    expect(moved!.fg).toBe("#8A7F6B");
    expect(moved!.text).toMatch(/^⟳ Meeting rescheduled — now .+/);
    const gone = calendarSystemRow("calendar.canceled.v1", { startAt: START, reason: "canceled" });
    expect(gone!.fg).toBe("#C9543F");
    expect(gone!.text).toMatch(/^✕ Meeting canceled — was .+/);
    expect(calendarSystemRow("calendar.canceled.v1", { reason: "no_show" })!.text).toBe("✕ Meeting no-show");
  });

  it("ONLY calendar.* types render — anything else returns null (never a fake bubble)", () => {
    expect(calendarSystemRow("email.replied.v1", {})).toBeNull();
    expect(calendarSystemRow("lead.stage_changed.v1", { toStage: "booked" })).toBeNull();
    expect(calendarSystemRow("calendar.unknown.v2", {})).toBeNull();
  });
});
