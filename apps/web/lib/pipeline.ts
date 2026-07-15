/**
 * P5 W3 (DEC-085): pipeline-board grouping — columns from the EXISTING
 * `PipelineStage` rows (workspace defaults, ordered), plus one honestly-
 * labeled overflow column for enrollments whose free-text stage is outside
 * the set (`Enrollment.pipelineStage` is unconstrained by design — e.g.
 * "replied" from the reply flow). Pure + pinned.
 */

export interface StageRow {
  id: string;
  key: string;
  label: string;
  order: number;
}

export interface BoardEnrollment {
  id: string;
  pipelineStage: string;
  status: string;
  updatedAt?: string;
  createdAt?: string;
  contact: { id: string; email: string | null; firstName: string | null; lastName: string | null; company: string | null };
}

export interface BoardColumn {
  key: string;
  label: string;
  /** True for the out-of-set overflow column (no drop target — not a stage). */
  overflow: boolean;
  cards: BoardEnrollment[];
}

export const OVERFLOW_KEY = "__other__";
export const OVERFLOW_LABEL = "Other stages";

export function buildBoard(stages: StageRow[], enrollments: BoardEnrollment[]): BoardColumn[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const known = new Set(ordered.map((s) => s.key));
  const columns: BoardColumn[] = ordered.map((s) => ({
    key: s.key,
    label: s.label,
    overflow: false,
    cards: [],
  }));
  const overflow: BoardColumn = { key: OVERFLOW_KEY, label: OVERFLOW_LABEL, overflow: true, cards: [] };
  for (const e of enrollments) {
    const col = known.has(e.pipelineStage) ? columns.find((c) => c.key === e.pipelineStage)! : overflow;
    col.cards.push(e);
  }
  // Newest activity first inside a column (stable for equal timestamps).
  for (const c of [...columns, overflow]) {
    c.cards.sort((a, b) =>
      String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")),
    );
  }
  return overflow.cards.length > 0 ? [...columns, overflow] : columns;
}

export function contactName(c: BoardEnrollment["contact"]): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email || "Unknown contact";
}
