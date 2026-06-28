import type { ReactNode } from "react";

export interface ToastProps {
  children: ReactNode;
  onClose?: () => void;
}

/** Dark surface, leading green dot, polite live region (§6). */
export function Toast({ children, onClose }: ToastProps) {
  return (
    <div className="cf-toast" role="status" aria-live="polite">
      <span className="cf-toast__dot" aria-hidden="true" />
      <span>{children}</span>
      {onClose ? (
        <button type="button" className="cf-toast__close" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  );
}
