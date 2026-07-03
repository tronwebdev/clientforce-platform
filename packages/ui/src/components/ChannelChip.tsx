import type { ReactNode } from "react";
import { MailIcon, MessageSquareIcon, MessagesSquareIcon, PhoneIcon } from "./icons";

export type Channel = "email" | "sms" | "whatsapp" | "voice";

/**
 * Prototype glyph → lucide mapping (A11; logged in PROGRESS.md's icon map):
 * ✉ → mail · 💬 → message-square · 🗨 → messages-square · ☎ → phone
 * (lucide geometry vendored in ./icons — see DEC-020).
 */
const CHANNEL_META: Record<Channel, { label: string; icon: ReactNode }> = {
  email: { label: "Email", icon: <MailIcon size={13} aria-hidden="true" /> },
  sms: { label: "SMS", icon: <MessageSquareIcon size={13} aria-hidden="true" /> },
  whatsapp: { label: "WhatsApp", icon: <MessagesSquareIcon size={13} aria-hidden="true" /> },
  voice: { label: "Voice", icon: <PhoneIcon size={13} aria-hidden="true" /> },
};

export interface ChannelChipProps {
  channel: Channel;
  /** "chip" = 12px/700 text chip (default) · "icon" = 30px icon square. */
  variant?: "chip" | "icon";
  /** Override the chip text (e.g. "Email · Step 2"). */
  label?: string;
}

/** Channel chip — colors ported verbatim from the Campaign View channel map. */
export function ChannelChip({ channel, variant = "chip", label }: ChannelChipProps) {
  const meta = CHANNEL_META[channel];
  if (variant === "icon") {
    return (
      <span
        className={`cf-chip cf-chip--icon cf-chip--${channel}`}
        role="img"
        aria-label={meta.label}
      >
        {meta.icon}
      </span>
    );
  }
  return (
    <span className={`cf-chip cf-chip--${channel}`}>
      {meta.icon}
      {label ?? meta.label}
    </span>
  );
}
