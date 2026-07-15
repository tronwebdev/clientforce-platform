/**
 * DEC-086 — the arc invariant, compose half: a guided step composes at the
 * SAME arc slot its scripted twin would plan. `arcRoleFor` (the composer's
 * position→role fold) and `arcRoleAt` (core's seed/display mirror) are two
 * implementations of one rule — this sweep pins them equivalent over every
 * registered arc and every (index, count) a real sequence can produce, so
 * they can never drift apart silently.
 */
import { describe, expect, it } from "vitest";
import { arcRoleAt, STRATEGY_ARCS } from "@clientforce/core";
import { arcRoleFor } from "../src/compose-email";

describe("arc invariant — compose-time slot ≡ plan/seed slot (DEC-086)", () => {
  it("arcRoleFor ≡ arcRoleAt for every registered arc across (index 1..count, count 1..8)", () => {
    for (const arc of Object.values(STRATEGY_ARCS)) {
      for (let count = 1; count <= 8; count++) {
        for (let index = 1; index <= count; index++) {
          expect(
            arcRoleFor(arc.roles, { index, count }),
            `${arc.key} index=${index} count=${count}`,
          ).toBe(arcRoleAt(arc.roles, index, count));
        }
      }
    }
  });
});
