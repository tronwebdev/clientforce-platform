export interface SegmentItem {
  value: string;
  label: string;
  count?: number;
}

export interface SegmentTabsProps {
  segments: SegmentItem[];
  value: string;
  onChange?: (value: string) => void;
  label?: string;
}

/**
 * Contacts segment row: 4px-gap tabs over a hairline rule; active = 700 weight
 * + 2px brand underline; 12px/700 count pills (prototype `Contacts.dc.html`).
 */
export function SegmentTabs({ segments, value, onChange, label = "Segments" }: SegmentTabsProps) {
  return (
    <div className="cf-segments" role="tablist" aria-label={label}>
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          role="tab"
          aria-selected={s.value === value}
          className={`cf-segment${s.value === value ? " cf-segment--active" : ""}`}
          onClick={() => onChange?.(s.value)}
        >
          {s.label}
          {s.count !== undefined ? <span className="cf-segment__count">{s.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
