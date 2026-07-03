import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Glyph/illustration slot (30px scale in the prototype). */
  glyph?: ReactNode;
  title: string;
  body?: string;
  /** Action buttons — pass at most ONE gradient primary (checkpoints §0). */
  actions?: ReactNode;
  /**
   * "empty" = no data yet (designed empty state with CTA) ·
   * "filtered" = active filters matched nothing (distinct copy, reset action).
   */
  kind?: "empty" | "filtered";
}

/**
 * Centered empty state (Contacts/Agents List prototypes): 30px glyph,
 * 15px/700 title, 13px muted body, inline action row. `kind` exists so
 * "no results for this filter" is never conflated with "no data yet".
 */
export function EmptyState({ glyph, title, body, actions, kind = "empty" }: EmptyStateProps) {
  return (
    <div className="cf-empty" data-kind={kind}>
      {glyph ? <div className="cf-empty__glyph">{glyph}</div> : null}
      <div className="cf-empty__title">{title}</div>
      {body ? <div className="cf-empty__body">{body}</div> : null}
      {actions ? <div className="cf-empty__actions">{actions}</div> : null}
    </div>
  );
}
