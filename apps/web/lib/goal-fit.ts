/**
 * W3-10 — goal→fit CONSTANT table (owner-approved direction, 2026-07-11),
 * keyed off the C2.9 GOALS registry (`GOAL_KEYS` — never a parallel enum;
 * R1's goal-seeded default rules key off the same registry).
 *
 * "existing_audience" goals work contacts you already have (reactivate /
 * upsell / reviews): step 3 highlights Upload CSV + Choose a list ("FOR THIS
 * GOAL"), step 4 defaults Auto-prospecting OFF with the "Not typical for
 * this goal" badge + an in-card note. Every other goal is "prospecting" and
 * step 4 is unchanged. The user's own toggle ALWAYS overrides the default.
 */
import type { GoalKey } from "@clientforce/core";

export type GoalFit = "existing_audience" | "prospecting";

export const GOAL_FIT: Record<GoalKey, GoalFit> = {
  book_appointments: "prospecting",
  generate_leads: "prospecting",
  reactivate_leads: "existing_audience",
  drive_signups: "prospecting",
  collect_reviews: "existing_audience",
  promote_offer: "prospecting",
  fill_event: "prospecting",
  upsell_clients: "existing_audience",
  custom: "prospecting",
};

export const goalFitOf = (goal: string | null | undefined): GoalFit =>
  GOAL_FIT[(goal ?? "") as GoalKey] ?? "prospecting";

/** Step-4 in-card note for existing-audience goals: goal icon + title + one line. */
export const AP_NOT_TYPICAL_NOTE: Record<string, { icon: string; title: string; line: string }> = {
  reactivate_leads: { icon: "♻", title: "Reactivate leads", line: "This goal works the contacts you already have — prospecting new leads usually isn't needed." },
  collect_reviews: { icon: "⭐", title: "Collect reviews", line: "Reviews come from your existing clients — prospecting new leads usually isn't needed." },
  upsell_clients: { icon: "📈", title: "Upsell clients", line: "Upsells go to current clients — prospecting new leads usually isn't needed." },
};

/**
 * W3-10 — "Suggested automations" templates per goal fit. STATIC at launch:
 * the CTAs deep-link to the Integrations/Automations nav stubs — no live
 * connector calls, no fake "connected" states (template copy verbatim from
 * the owner-approved kickoff).
 */
export interface SuggestedAutomation {
  icon: string;
  title: string;
  desc: string;
  href: "/integrations" | "/automations";
  cta: string;
}

export const SUGGESTED_AUTOMATIONS: Record<GoalFit, [SuggestedAutomation, SuggestedAutomation]> = {
  existing_audience: [
    { icon: "🔌", title: "Sync lapsed patients from your CRM", desc: "Pull the audience for this goal straight from the system that already knows them.", href: "/integrations", cta: "Open Integrations ›" },
    { icon: "⏱", title: "Re-enroll a list on a schedule", desc: "Run this campaign again automatically — monthly, quarterly, or on your own cadence.", href: "/automations", cta: "Open Automations ›" },
  ],
  prospecting: [
    { icon: "🔗", title: "New form fill → enroll here", desc: "Route every new form submission straight into this campaign.", href: "/automations", cta: "Open Automations ›" },
    { icon: "☎", title: "Missed call → instant follow-up", desc: "Turn missed calls into an automatic first touch from this agent.", href: "/automations", cta: "Open Automations ›" },
  ],
};
