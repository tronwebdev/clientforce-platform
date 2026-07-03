import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Pill-shaped shimmer (avatars, chips). */
  round?: boolean;
  style?: CSSProperties;
}

/**
 * Loading shimmer — checkpoints §0 convention ("loading = skeleton, not a
 * spinner"). No prototype anchor exists (logged in PROGRESS.md); tones stay on
 * the neutral hairline/line-soft tokens, static under prefers-reduced-motion.
 */
export function Skeleton({ width = "100%", height = 14, round = false, style }: SkeletonProps) {
  return (
    <span
      className="cf-skeleton"
      aria-hidden="true"
      style={{
        width,
        height,
        ...(round ? { borderRadius: "var(--cf-radius-pill)" } : {}),
        ...style,
      }}
    />
  );
}
