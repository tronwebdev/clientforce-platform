export interface DropdownItem {
  value: string;
  label: string;
}

export interface DropdownProps {
  label: string;
  header?: string;
  items: DropdownItem[];
  /** Currently-selected value (renders a ✓). */
  value?: string;
  /** Controlled open state. */
  open?: boolean;
  onToggle?: () => void;
  onSelect?: (value: string) => void;
}

/** Controlled menu — surface card, dropdown shadow, uppercase header, ✓ on active (§6). */
export function Dropdown({ label, header, items, value, open = false, onToggle, onSelect }: DropdownProps) {
  return (
    <div className="cf-dropdown">
      <button
        type="button"
        className="cf-button cf-button--secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      {open && (
        <div className="cf-dropdown__menu" role="menu" aria-label={label}>
          {header ? <div className="cf-dropdown__header">{header}</div> : null}
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === value}
              className="cf-dropdown__item"
              onClick={() => onSelect?.(item.value)}
            >
              <span>{item.label}</span>
              {item.value === value ? (
                <span className="cf-dropdown__check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
