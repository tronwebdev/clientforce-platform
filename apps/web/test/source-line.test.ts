import { describe, expect, it } from "vitest";
import { lastReadPhrase } from "../components/bold/settings/settings-data";

/**
 * B7.6 / REDO §1.2 — a knowledge source must say WHEN it was last read.
 *
 * The prototype's sub-line is `Read weekly · 9 pages · last Tuesday`; B7.5
 * kept the yield and dropped the date, which is the half that tells you
 * whether to trust the source at all. `updatedAt` was on the row the whole
 * time, so nothing here is invented.
 */
describe("lastReadPhrase", () => {
  const now = new Date("2026-09-01T12:00:00Z"); // a Tuesday

  it("says it plainly for today and yesterday", () => {
    expect(lastReadPhrase("2026-09-01T09:00:00Z", now)).toBe("today");
    expect(lastReadPhrase("2026-08-31T09:00:00Z", now)).toBe("yesterday");
  });

  it("names the weekday inside the last week, as a person would", () => {
    // 2026-08-28 is a Friday, four days back.
    expect(lastReadPhrase("2026-08-28T09:00:00Z", now)).toBe("last Friday");
  });

  it("degrades once a weekday stops being unambiguous", () => {
    expect(lastReadPhrase("2026-08-24T09:00:00Z", now)).toBe("a week ago");
    expect(lastReadPhrase("2026-08-04T09:00:00Z", now)).toBe("4 weeks ago");
    expect(lastReadPhrase("2026-05-04T09:00:00Z", now)).toBe("May 4");
  });

  it("returns null rather than a wrong phrase for unusable input", () => {
    expect(lastReadPhrase("not a date", now)).toBeNull();
    // A future timestamp is clock skew, not a reading — say nothing.
    expect(lastReadPhrase("2026-09-09T09:00:00Z", now)).toBeNull();
  });
});
