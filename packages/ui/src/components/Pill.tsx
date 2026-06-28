import type { HTMLAttributes, ReactNode } from "react";

export type PillTone = "success" | "warn" | "neutral";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  children: ReactNode;
}

export function Pill({ tone = "neutral", className, children, ...props }: PillProps) {
  return (
    <span className={["cf-pill", `cf-pill--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
