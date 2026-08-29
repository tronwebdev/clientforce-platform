import { type WidgetQuickActionKind } from "./widget";

/**
 * DEC-127: industry-relevant widget vocabulary. Capability NAMES resolve from
 * this registry keyed by the Business Core's vertical — the GOAL_META pattern —
 * so no shared surface hard-codes one industry's words (dental "Book a visit" /
 * SaaS "Book a demo" / salon "Book an appointment"). Framing copy around a
 * name stays with its surface; the names live here. Two stances per slot:
 * `visitor` is what the widget chip says, `owner` is what the Site agent
 * action picker calls the same capability.
 *
 * The vertical's real home is the Business Core; no such field exists yet
 * (Q-096), so resolvers read the interim `Widget.design.vertical` and an
 * unknown or absent vertical falls back to the neutral default — a stray
 * string can never break a render.
 */
export type WidgetCapabilitySlot = WidgetQuickActionKind | "live_voice";

export const WIDGET_CAPABILITY_VOCAB: Record<
  WidgetCapabilitySlot,
  {
    visitor: string;
    owner: string;
    byVertical?: Record<string, { visitor?: string; owner?: string }>;
  }
> = {
  ask_question: { visitor: "Ask a question", owner: "Answer questions" },
  schedule_callback: { visitor: "Schedule a callback", owner: "Schedule a callback" },
  book_visit: {
    visitor: "Book an appointment",
    owner: "Book an appointment",
    byVertical: {
      dental: { visitor: "Book a visit", owner: "Book a visit" },
      saas: { visitor: "Book a demo", owner: "Book a demo" },
      salon: { visitor: "Book an appointment", owner: "Book an appointment" },
    },
  },
  call_me_back: { visitor: "Call me back", owner: "Call me now" },
  estimate: { visitor: "Get an estimate", owner: "Instant estimate" },
  live_voice: { visitor: "Live voice", owner: "Live voice" },
};

/** Resolve a capability's display name for a stance; unknown vertical → default. */
export function widgetCapabilityLabel(
  slot: WidgetCapabilitySlot,
  stance: "visitor" | "owner",
  vertical?: string | null,
): string {
  const row = WIDGET_CAPABILITY_VOCAB[slot];
  if (vertical) {
    const flavored = row.byVertical?.[vertical]?.[stance];
    if (flavored) return flavored;
  }
  return row[stance];
}
