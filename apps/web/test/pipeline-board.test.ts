/**
 * P5 W3 (DEC-085): pipeline-board grouping pins — stage order, the honest
 * out-of-set overflow column (present only when needed, never a drop target
 * by contract), card sorting, and the card title fallback.
 */
import { describe, expect, it } from "vitest";
import { buildBoard, contactName, OVERFLOW_KEY, type BoardEnrollment, type StageRow } from "../lib/pipeline";

const stages: StageRow[] = [
  { id: "s2", key: "contacted", label: "Contacted", order: 2 },
  { id: "s1", key: "new", label: "New", order: 1 },
  { id: "s3", key: "booked", label: "Booked", order: 5 },
];
const enr = (id: string, stage: string, over: Partial<BoardEnrollment> = {}): BoardEnrollment => ({
  id,
  pipelineStage: stage,
  status: "ACTIVE",
  updatedAt: "2026-07-15T10:00:00.000Z",
  contact: { id: `c-${id}`, email: `${id}@x.test`, firstName: null, lastName: null, company: null },
  ...over,
});

describe("buildBoard", () => {
  it("columns come from PipelineStage rows in `order`, cards grouped by stage key", () => {
    const board = buildBoard(stages, [enr("a", "new"), enr("b", "booked"), enr("c", "new")]);
    expect(board.map((c) => c.key)).toEqual(["new", "contacted", "booked"]);
    expect(board[0]?.cards.map((e) => e.id).sort()).toEqual(["a", "c"]);
    expect(board[1]?.cards).toHaveLength(0); // an empty stage column still renders
  });

  it("out-of-set stages collect in ONE honestly-labeled overflow column — only when they exist", () => {
    const clean = buildBoard(stages, [enr("a", "new")]);
    expect(clean.some((c) => c.key === OVERFLOW_KEY)).toBe(false);
    const board = buildBoard(stages, [enr("a", "new"), enr("b", "replied"), enr("c", "qualified_out")]);
    const overflow = board.find((c) => c.key === OVERFLOW_KEY)!;
    expect(overflow.overflow).toBe(true);
    expect(overflow.label).toBe("Other stages");
    expect(overflow.cards.map((e) => e.id).sort()).toEqual(["b", "c"]);
  });

  it("cards sort newest-activity-first inside a column", () => {
    const board = buildBoard(stages, [
      enr("old", "new", { updatedAt: "2026-07-10T00:00:00.000Z" }),
      enr("fresh", "new", { updatedAt: "2026-07-15T00:00:00.000Z" }),
    ]);
    expect(board[0]?.cards.map((e) => e.id)).toEqual(["fresh", "old"]);
  });

  it("contactName: name → email → honest fallback", () => {
    expect(contactName({ id: "1", email: "e@x.t", firstName: "Ada", lastName: "L", company: null })).toBe("Ada L");
    expect(contactName({ id: "1", email: "e@x.t", firstName: null, lastName: null, company: null })).toBe("e@x.t");
    expect(contactName({ id: "1", email: null, firstName: null, lastName: null, company: null })).toBe("Unknown contact");
  });
});
