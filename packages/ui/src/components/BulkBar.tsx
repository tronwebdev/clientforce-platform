export interface BulkAction {
  key: string;
  label: string;
  onAction?: () => void;
  danger?: boolean;
}

export interface BulkBarProps {
  count: number;
  onClear?: () => void;
  actions: BulkAction[];
  /** Noun for the count line, default "selected". */
  countLabel?: string;
}

/**
 * Selection action bar (Contacts prototype): green-tint fill + border, radius
 * 12, "N selected" + Clear on the left, white action buttons on the right
 * (destructive = danger red on its own border tone).
 */
export function BulkBar({ count, onClear, actions, countLabel = "selected" }: BulkBarProps) {
  return (
    <div className="cf-bulkbar" role="toolbar" aria-label="Bulk actions">
      <span className="cf-bulkbar__count">
        {count} {countLabel}
      </span>
      <button type="button" className="cf-bulkbar__clear" onClick={onClear}>
        Clear
      </button>
      <div className="cf-bulkbar__actions">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`cf-bulkbar__action${a.danger ? " cf-bulkbar__action--danger" : ""}`}
            onClick={a.onAction}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
