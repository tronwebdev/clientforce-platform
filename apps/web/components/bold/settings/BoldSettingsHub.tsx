"use client";

/**
 * The settings hub (SURFACE_SPEC_SETTINGS §3) — six cards, each a door.
 *
 * Every pill and every subtitle number is server-derived. Where a card cannot
 * compute the number the design shows, it says the honest thing instead: a
 * workspace whose senders have never started warming reads "Warm-up not
 * started", not "0%", because 0% is a measurement and this is an absence.
 */
import type { CSSProperties } from "react";
import { workspaceRoleWord } from "@clientforce/core";
import { CHIP, SURFACE } from "../bold-settings-kit";
import {
  domainCount,
  emailSenders,
  pluralise,
  smsSenders,
  spellCount,
  spellCountLead,
  warmupPercent,
  type SettingsSnapshot,
} from "./settings-data";

export type HubTarget = "core" | "senders" | "team" | "guard" | "credits" | "integrations";

interface HubCard {
  key: HubTarget;
  n: string;
  sub: string;
  ic: string;
  tint: [string, string, string];
  pill?: { label: string; tone: "live" | "warn" };
}

const TINT: Record<string, [string, string, string]> = {
  forest: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  cyan: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  plum: ["#F0EDF9", "#DCD5EF", "#5B4A8A"],
  amber: ["var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-amber)"],
  slate: ["var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
};

/**
 * The prototype's sub-line describes WHAT LIVES INSIDE the card and carries no
 * number at all ("Who you are, what you sell, hours and prices. Everything Ada
 * quotes." — dc.html, and SURFACE_SPEC_SETTINGS §3 line 57 defines the element
 * that way too). B7.5 replaced it with a count sentence that also restated the
 * gaps pill sitting 12px below it — the same number twice on one card.
 *
 * No honesty gate is in play here: the prototype's sentence contains no number,
 * so nothing unsourced is being withheld. The build simply volunteered counts
 * the prototype never asked for.
 */
function coreSub(): string {
  return "Who you are, what you sell, hours and prices. Everything Ada quotes.";
}

function sendersSub(d: SettingsSnapshot): string {
  if (d.senders === null) return "Where your email and messages come from.";
  // DOMAINS, not sender rows: two mailboxes on one domain is one domain, and
  // the prototype and the Senders stat strip both count domains.
  const domains = domainCount(emailSenders(d.senders).map((x) => x.fromEmail));
  const nums = smsSenders(d.senders).length;
  const pct = warmupPercent(d.senders);
  // An absence is worded, never drawn as a zero — the doctrine this family
  // already follows on the page one click inside ("NUMBERS 0 · none yet").
  const numPart = nums === 0 ? "no number yet" : spellCount(nums, "number", "numbers");
  const head = `${spellCountLead(domains, "email domain", "email domains")} and ${numPart}.`;
  // No ramp ⇒ nothing to report. A "0%" here would read as a stalled warm-up.
  return pct === null ? `${head} Warm-up not started.` : `${head} Warm-up is at ${pct}%.`;
}

function teamSub(d: SettingsSnapshot): string {
  if (d.members === null) return "Who can do what here.";
  const pending = (d.invites ?? []).filter((i) => i.state === "pending").length;
  // The words come from the shared vocabulary, never the raw enum — lowercasing
  // `m.role` is what put "Agent, viewer." on this card for a human.
  // Ada holds a role too, and the prototype's third role word is hers —
  // "Two people plus Ada. Owner, admin, viewer." A list built from the human
  // members alone can never name the role of the agent the sentence just
  // mentioned.
  const roles = [...new Set(d.members.map((m) => workspaceRoleWord(m.role).toLowerCase()))];
  const withAda = roles.includes("agent") ? roles : [...roles, "agent"];
  // "Owner, admin, agent." — sentence case, in the order the enum ranks them.
  const said =
    withAda.length === 0
      ? ""
      : `${withAda[0]![0]!.toUpperCase()}${withAda[0]!.slice(1)}${withAda.length > 1 ? `, ${withAda.slice(1).join(", ")}` : ""}. `;
  const waiting = pending > 0 ? `${pluralise(pending, "invite", "invites")} waiting.` : "";
  return `${spellCountLead(d.members.length, "person", "people")} plus Ada. ${said}${waiting}`.trim();
}

function creditsSub(d: SettingsSnapshot): string {
  if (d.credits === null) return "Where they go, what things cost, top up.";
  return `${d.credits.balance.toLocaleString("en-US")} left. Where they go, what things cost, top up.`;
}

export function BoldSettingsHub({
  data,
  onOpen,
}: {
  data: SettingsSnapshot;
  onOpen: (t: HubTarget) => void;
}) {
  const gaps = data.gaps?.length ?? 0;
  const senderRows = data.senders ?? [];
  const unhealthy = senderRows.some((s) => s.health?.state === "unhealthy");
  const verified =
    senderRows.length > 0 &&
    senderRows.every((s) => {
      const st = (s.domainAuthStatus ?? {}) as Record<string, { status?: string; pass?: boolean }>;
      const entries = Object.values(st);
      return (
        entries.length > 0 && entries.every((v) => v?.status === "verified" || v?.pass === true)
      );
    });

  const cards: HubCard[] = [
    {
      key: "core",
      n: "Business core",
      sub: coreSub(),
      ic: "◉",
      tint: TINT.forest!,
      pill:
        data.gaps === null
          ? undefined
          : gaps > 0
            ? { label: pluralise(gaps, "gap", "gaps"), tone: "warn" }
            : { label: "No gaps", tone: "live" },
    },
    {
      key: "senders",
      n: "Senders",
      sub: sendersSub(data),
      ic: "✉",
      tint: TINT.cyan!,
      pill:
        data.senders === null
          ? undefined
          : unhealthy
            ? { label: "Needs a look", tone: "warn" }
            : verified
              ? { label: "All verified", tone: "live" }
              : // A workspace whose DNS was never checked fell through BOTH
                // branches and rendered a bare card — while the page one click
                // inside showed an amber "Needs a look". The hub and the page it
                // opens can never disagree, so the unchecked state gets said.
                { label: "Not checked yet", tone: "warn" },
    },
    { key: "team", n: "Team and roles", sub: teamSub(data), ic: "◍", tint: TINT.plum! },
    {
      key: "guard",
      n: "Guardrails",
      sub: "Workspace-wide limits every campaign inherits.",
      ic: "⛨",
      tint: TINT.amber!,
    },
    { key: "credits", n: "Credits and usage", sub: creditsSub(data), ic: "◆", tint: TINT.forest! },
    {
      key: "integrations",
      n: "Integrations",
      sub: "Calendar, Stripe and the ads closed loop.",
      ic: "⇄",
      tint: TINT.slate!,
      pill:
        data.connectedIntegrations != null && data.connectedIntegrations > 0
          ? { label: `${data.connectedIntegrations} connected`, tone: "live" }
          : undefined,
    },
  ];

  /**
   * QUIET card, not raised. The prototype's hub card is flat #FCFCFC with an
   * #ECEDEC hairline and no shadow (dc.html:1579) — and SURFACE_SPEC_SETTINGS
   * line 35 agrees with it: "Panel gradients #FFFFFF → #F7FAF8 on raised
   * cards; flat #FCFCFC on quiet cards." B7.5 applied the RAISED half of the
   * style contract to a card the spec's own sentence calls quiet.
   *
   * Hover and entrance come from a class, because inline styles can express
   * neither. The prototype gives the whole card a hover lift — it is the click
   * target, so it says so — and an entrance animation on mount.
   */
  const cardStyle: CSSProperties = {
    ...SURFACE.quiet,
    borderRadius: 20,
    padding: 20,
    cursor: "pointer",
  };

  return (
    <div data-testid="bold-wssettings" style={{ padding: "26px 40px 40px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.key}
            data-testid={`bold-wss-${c.key}`}
            onClick={() => onOpen(c.key)}
            className="cvb-hub-card"
            style={cardStyle}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  flex: "none",
                  background: c.tint[0],
                  border: `1px solid ${c.tint[1]}`,
                  color: c.tint[2],
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                }}
              >
                {c.ic}
              </span>
              <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>
                {c.n}
              </span>
              <span style={{ fontSize: 13, color: "var(--cvb-faint)" }}>→</span>
            </div>
            <div
              style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 11 }}
            >
              {c.sub}
            </div>
            {c.pill ? (
              <span
                // 9.5px here, not the shared CHIP's 10px: the prototype sizes
                // the hub-card pill and the item-page row chip differently
                // (dc.html card pill 9.5px vs row chip :2344 at 10px), and one
                // shared atom had flattened the two into a single size.
                style={{
                  ...(c.pill.tone === "live" ? CHIP.live : CHIP.warn),
                  fontSize: 9.5,
                  display: "inline-block",
                  marginTop: 12,
                }}
              >
                {c.pill.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
