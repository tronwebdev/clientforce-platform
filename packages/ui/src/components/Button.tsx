import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

/** Primary = brand gradient on near-black; secondary = hairline; ghost = green tint. */
export function Button({
  variant = "primary",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const cls = ["cf-button", `cf-button--${variant}`, className].filter(Boolean).join(" ");
  return (
    <button className={cls} type={type} {...props}>
      {children}
    </button>
  );
}
