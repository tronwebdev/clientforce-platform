import type { ReactNode } from "react";
import { SearchIcon, SparklesIcon } from "./icons";

export interface EmptyStateProps {
  title: string;
  body?: string;
  /**
   * Action buttons. Rule (owner decision, PROGRESS DEC-021): the gradient
   * primary CTA belongs to TRUE-empty only — filtered-empty carries secondary
   * actions only (one gradient CTA per view).
   */
  actions?: ReactNode;
  /**
   * "empty" = no data yet (Agents List `allEmpty` anatomy: Bricolage 22/700
   * title, sparkles tile, gradient CTA) ·
   * "filtered" = active filters matched nothing (search tile, secondary
   * actions, distinct copy).
   */
  kind?: "empty" | "filtered";
  /** Override the tile icon (defaults: sparkles for empty, search for filtered). */
  icon?: ReactNode;
}

/**
 * Centered empty state with the 90px radius-24 gradient icon tile (ported from
 * `Agents List.dc.html` `allEmpty`). Icons are lucide (A11) — sparkles /
 * search by kind — never OS emoji.
 */
export function EmptyState({ title, body, actions, kind = "empty", icon }: EmptyStateProps) {
  const tileIcon =
    icon ??
    (kind === "empty" ? (
      <SparklesIcon size={36} aria-hidden="true" />
    ) : (
      <SearchIcon size={36} aria-hidden="true" />
    ));
  return (
    <div className="cf-empty" data-kind={kind}>
      <div className="cf-empty__tile" aria-hidden="true">
        {tileIcon}
      </div>
      <div className="cf-empty__title">{title}</div>
      {body ? <div className="cf-empty__body">{body}</div> : null}
      {actions ? <div className="cf-empty__actions">{actions}</div> : null}
    </div>
  );
}
