import type { SVGProps } from "react";

/**
 * Lucide icon geometry, vendored (ISC) — see PROGRESS DEC-020: lucide-react's
 * published CJS entry is broken under a plain Node require chain (its
 * package.json says `"type": "module"`, so Node parses the "cjs" build as
 * ESM), which crashes Next SSR through this package's CJS dist. The A11
 * mapping is unchanged — these ARE the lucide `mail` / `message-square` /
 * `messages-square` / `phone` / `minus` / `plus` icons; app code outside this
 * package uses the lucide-react package directly (bundlers handle it fine).
 */
function icon(size: number | undefined, props: SVGProps<SVGSVGElement>) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    width: size ?? 24,
    height: size ?? 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export function MailIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

export function MessageSquareIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function MessagesSquareIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

export function PhoneIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function MinusIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function PlusIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function XIcon({ size, ...props }: IconProps) {
  return (
    <svg {...icon(size, props)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
