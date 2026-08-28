/**
 * B3c-2: deterministic clocks for the voice specs. The dial rail enforces an
 * 08:00–21:00 CONTACT-local floor, so a fixture contact with no timezone
 * (UTC fallback) makes every dial test hostage to the runner's wall clock —
 * green all day, red after 21:00 UTC. Giving the fixture contact a timezone
 * that is CURRENTLY awake (with margin) makes the rail's non-timing gates
 * testable at any hour, through the same resolver production uses.
 */
const ZONES = [
  "Pacific/Kiritimati",
  "Pacific/Auckland",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Europe/Berlin",
  "UTC",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Honolulu",
];

const localHour = (tz: string): number =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .find((p) => p.type === "hour")!.value,
  );

/** A timezone whose local clock sits WELL inside the 08:00–21:00 floor. */
export function awakeTimezone(): string {
  const hit = ZONES.find((z) => {
    const h = localHour(z);
    return h >= 9 && h < 20;
  });
  if (!hit) throw new Error("no awake timezone found — the zone list spans the globe, this cannot happen");
  return hit;
}

/** A timezone whose local clock is OUTSIDE the floor (the quiet-hours leg). */
export function quietTimezone(): string {
  const hit = ZONES.find((z) => {
    const h = localHour(z);
    return h < 8 || h >= 21;
  });
  if (!hit) throw new Error("no quiet timezone found — the zone list spans the globe, this cannot happen");
  return hit;
}
