export interface ToggleProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Accessible label (icon-only control). */
  label: string;
  disabled?: boolean;
  id?: string;
}

/** Controlled switch — 44×26 track, brand gradient when on (DESIGN_TOKENS.md §6). */
export function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={["cf-toggle", checked ? "cf-toggle--on" : ""].filter(Boolean).join(" ")}
      onClick={() => onChange?.(!checked)}
    >
      <span className="cf-toggle__knob" />
    </button>
  );
}
