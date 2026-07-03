import { MinusIcon, PlusIcon } from "./icons";

export interface StepperProps {
  value: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Accessible label, e.g. "Daily email cap". */
  label: string;
}

/**
 * Volume-limits stepper (Campaign View modal): pill track on #FBF7F0 with
 * 26px round ± buttons and a 15/800 tabular-nums value (min-width 46).
 * Prototype glyphs −/+ → lucide minus/plus (A11; vendored — DEC-020).
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  label,
}: StepperProps) {
  const canDec = !disabled && (min === undefined || value - step >= min);
  const canInc = !disabled && (max === undefined || value + step <= max);
  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  };
  return (
    <div className="cf-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="cf-stepper__btn"
        aria-label={`Decrease ${label}`}
        disabled={!canDec}
        onClick={() => onChange?.(clamp(value - step))}
      >
        <MinusIcon size={14} aria-hidden="true" />
      </button>
      <span className="cf-stepper__value" aria-live="polite">
        {value.toLocaleString("en-US")}
      </span>
      <button
        type="button"
        className="cf-stepper__btn"
        aria-label={`Increase ${label}`}
        disabled={!canInc}
        onClick={() => onChange?.(clamp(value + step))}
      >
        <PlusIcon size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
