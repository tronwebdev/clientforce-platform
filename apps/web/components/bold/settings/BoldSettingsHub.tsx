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
  emailSenders,
  pluralise,
  smsSenders,
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

function coreSub(d: SettingsSnapshot): string {
  if (d.fields === null) return "Who you are, what you sell, hours and prices. Everything Ada quotes.";
  const gaps = d.gaps?.length ?? 0;
  const facts = pluralise(d.fields.length, "fact", "facts");
  return gaps === 0
    ? `${facts} she quotes from. Your live campaigns are not missing anything.`
    : `${facts} she quotes from, and ${pluralise(gaps, "thing", "things")} your live campaigns still miss.`;
}

function sendersSub(d: SettingsSnapshot): string {
  if (d.senders === null) return "Where your email and messages come from.";
  const email = emailSenders(d.senders).length;
  const nums = smsSenders(d.senders).length;
  const pct = warmupPercent(d.senders);
  const head = `${pluralise(email, "email sender", "email senders")} and ${pluralise(nums, "number", "numbers")}.`;
  // No ramp ⇒ nothing to report. A "0%" here would read as a stalled warm-up.
  return pct === null ? `${head} Warm-up not started.` : `${head} Warm-up is at ${pct}%.`;
}

function teamSub(d: SettingsSnapshot): string {
  if (d.members === null) return "Who can do what here.";
  const pending = (d.invites ?? []).filter((i) => i.state === "pending").length;
  // The words come from the shared vocabulary, never the raw enum — lowercasing
  // `m.role` is what put "Agent, viewer." on this card for a human.
  const roles = [...new Set(d.members.map((m) => workspaceRoleWord(m.role).toLowerCase()))];
  // "Owner, admin, member." — sentence case, in the order the enum ranks them.
  const said = roles.length === 0 ? "" : `${roles[0]![0]!.toUpperCase()}${roles[0]!.slice(1)}${roles.length > 1 ? `, ${roles.slice(1).join(", ")}` : ""}. `;
  const waiting = pending > 0 ? `${pluralise(pending, "invite", "invites")} waiting.` : "";
  return `${pluralise(d.members.length, "person", "people")} plus Ada. ${said}${waiting}`.trim();
}

function creditsSub(d: SettingsSnapshot): string {
  if (d.credits === null) return "Where they go, what things cost, top up.";
  return `${d.credits.balance.toLocaleString("en-US")} left. Where they go, what things cost, top up.`;
}

export function BoldSettingsHub({ data, onOpen }: { data: SettingsSnapshot; onOpen: (t: HubTarget) => void }) {
  const gaps = data.gaps?.length ?? 0;
  const senderRows = data.senders ?? [];
  const unhealthy = senderRows.some((s) => s.health?.state === "unhealthy");
  const verified =
    senderRows.length > 0 &&
    senderRows.every((s) => {
      const st = (s.domainAuthStatus ?? {}) as Record<string, { status?: string; pass?: boolean }>;
      const entries = Object.values(st);
      return entries.length > 0 && entries.every((v) => v?.status === "verified" || v?.pass === true);
    });

  const cards: HubCard[] = [
    {
      key: "core",
      n: "Business core",
      sub: coreSub(data),
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
              : undefined,
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
      sub: "Calendar, payments and the rest of your stack.",
      ic: "⇄",
      tint: TINT.slate!,
      pill:
        data.connectedIntegrations != null && data.connectedIntegrations > 0
          ? { label: `${data.connectedIntegrations} connected`, tone: "live" }
          : undefined,
    },
  ];

  const cardStyle: CSSProperties = { ...SURFACE.card, padding: 20, cursor: "pointer" };

  return (
    <div data-testid="bold-wssettings" style={{ padding: "26px 40px 40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {cards.map((c) => (
          <div key={c.key} data-testid={`bold-wss-${c.key}`} onClick={() => onOpen(c.key)} style={cardStyle}>
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
              <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>{c.n}</span>
              <span style={{ fontSize: 13, color: "var(--cvb-faint)" }}>→</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 11 }}>{c.sub}</div>
            {c.pill ? (
              <span style={{ ...(c.pill.tone === "live" ? CHIP.live : CHIP.warn), display: "inline-block", marginTop: 12 }}>
                {c.pill.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
