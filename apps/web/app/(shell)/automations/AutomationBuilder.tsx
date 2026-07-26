"use client";

/**
 * Automation builder (R1-UI W2, DEC-091) — the canon 740px modal from
 * `Automations.dc.html`: name header · recipes (blank + new only) · grouped
 * trigger picker with search · selected-trigger card + per-trigger config ·
 * Only-if filter · action cards with reorder + per-action config · grouped
 * action picker with search · summary footer + Cancel / Save.
 *
 * The pickers RENDER the engine's typed vocabulary: expressible entries
 * derive from the core unions via the display maps (never a parallel enum);
 * canon entries the engine can't express render HONEST-ABSENT (disabled,
 * reason naming the future capability — the Q-030+ ledger). The canon's
 * intent-flavoured reply triggers (Positive reply / Objection / Question /
 * OOO) fold into `reply_classified`'s intent multi-pick; its 14-field
 * condition matrix renders as the ONE engine condition (keyword refinement,
 * reply triggers only — the boundary refuses the rest, so the builder says
 * so instead of offering dead rows).
 *
 * Save goes through the REAL engine validation (`automationWriteSchema`
 * client-side for the button state, the API boundary authoritatively) — a
 * dup-trigger or scope 422 renders its detail VERBATIM in the inline error
 * strip (the #88/#94 precedent), never a silent overwrite.
 */
import { useMemo, useState } from "react";
import {
  automationWriteSchema,
  type AutomationWrite,
  type CampaignRuleAction,
  type CampaignRuleActionKind,
  type CampaignRuleTrigger,
  type CampaignRuleTriggerKind,
} from "@clientforce/core";
import type { AutomationListRow } from "../../../lib/types";
import { CfError } from "../../../components/sequence/shared";
import {
  ABSENT_TRIGGERS,
  REPLY_INTENT_OPTIONS,
  TRIGGER_DESCRIPTIONS,
  TRIGGER_GROUP,
  TRIGGER_ICONS,
  TRIGGER_OPTIONS,
  TRIGGER_PICKER_GROUPS,
  triggerChip,
} from "../../../lib/triggers";
import {
  ABSENT_ACTIONS,
  ACCOUNT_ACTION_OPTIONS,
  ACTION_ICONS,
  ACTION_PICKER_GROUPS,
  actionChip,
} from "../../../lib/actions";
import { intentTint } from "../../../lib/intents";
import { cf } from "./AutomationsView";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const SECTION: React.CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 9 };
const GROUP_LABEL: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const CONNECTOR = (
  <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
    <span style={{ width: 2, height: 14, background: "#D8CFBE" }} />
  </div>
);
const INPUT: React.CSSProperties = { fontSize: 13, color: "#0E1512", border: "1px solid #EBE3D6", borderRadius: 9, padding: "8px 12px", background: "#fff" };

/** The default payload per picked kind (canon TRIG cfg defaults). */
export function defaultTriggerFor(kind: CampaignRuleTriggerKind): CampaignRuleTrigger {
  switch (kind) {
    case "reply_classified":
      return { kind, intents: ["interested"] };
    case "sequence_quiet":
      return { kind, days: 14 };
    // INT W2 (DEC-094): the one parameterized meeting kind — a day before.
    case "before_meeting":
      return { kind, hours: 24 };
    default:
      return { kind };
  }
}

/** The default payload per picked kind (canon ACT cfg defaults; run_automation
 *  points at the first chainable rule — the picker entry is disabled when none
 *  exists, so "" never reaches the API). */
export function defaultActionFor(
  kind: CampaignRuleActionKind,
  firstAutomationId: string | null,
): CampaignRuleAction {
  switch (kind) {
    case "add_tag":
      return { kind, tag: "hot-lead" };
    case "set_stage":
      return { kind, stage: "qualified", label: "Qualified" };
    case "notify_team":
      return { kind };
    case "run_automation":
      return { kind, automationId: firstAutomationId ?? "" };
    case "move_to_node":
      // Never offered by the account picker (ACCOUNT_ACTION_OPTIONS) — the
      // exhaustive switch still covers the union so a new kind fails here.
      return { kind, targetNodeId: "" };
    default:
      return { kind };
  }
}

/** Comma-separated keyword entry ⇄ the ONE engine condition. */
export function keywordsToConditions(raw: string | null): AutomationWrite["conditions"] {
  if (raw === null) return [];
  const keywords = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 10);
  return keywords.length > 0 ? [{ kind: "keyword_contains", keywords }] : [];
}

export interface AutomationRecipe {
  name: string;
  desc: string;
  icon: string;
  write: Pick<AutomationWrite, "trigger" | "conditions" | "actions">;
}

/** Canon "Quick start from a recipe" — pre-filled BUILDER STATES, all fully
 *  expressible in the engine vocabulary (drift-guarded in tests: every recipe
 *  parses through `automationWriteSchema`). The canon's inexpressible pair
 *  (Booked → CRM deal · Welcome new leads) is honest-absent via the pickers'
 *  ledger, never a recipe that can't save. */
export const AUTOMATION_RECIPES: readonly AutomationRecipe[] = [
  {
    name: "Qualify hot replies",
    desc: "Interested reply → stage + notify",
    icon: "↩",
    write: {
      trigger: { kind: "reply_classified", intents: ["interested"] },
      conditions: [],
      actions: [
        { kind: "set_stage", stage: "qualified", label: "Qualified" },
        { kind: "notify_team", note: "Hot reply — take a look" },
      ],
    },
  },
  {
    name: "Meeting booked → tag & notify",
    desc: "Booked → tag + team ping",
    icon: "📅",
    write: {
      trigger: { kind: "meeting_booked" },
      conditions: [],
      actions: [{ kind: "add_tag", tag: "booked" }, { kind: "notify_team", note: "Meeting booked" }],
    },
  },
  {
    name: "Stop on unsubscribe",
    desc: "Opt-out → end campaign",
    icon: "⊘",
    write: {
      trigger: { kind: "opted_out" },
      conditions: [],
      actions: [{ kind: "end_enrollment" }],
    },
  },
  {
    name: "Re-engage quiet leads",
    desc: "30 days quiet → tag + notify",
    icon: "⏳",
    write: {
      trigger: { kind: "sequence_quiet", days: 30 },
      conditions: [],
      actions: [
        { kind: "add_tag", tag: "re-engage" },
        { kind: "notify_team", note: "Gone quiet — worth a manual touch" },
      ],
    },
  },
];

interface BuilderAction {
  uid: number;
  action: CampaignRuleAction;
}

let nextUid = 1;

export function AutomationBuilder({
  automations,
  editing,
  openActionPicker = false,
  onClose,
  onSaved,
}: {
  automations: AutomationListRow[];
  editing: AutomationListRow | null;
  /** Drawer's "+ Add an action" entry point — opens with the picker expanded. */
  openActionPicker?: boolean;
  onClose: () => void;
  onSaved: (mode: "created" | "updated") => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [trigger, setTrigger] = useState<CampaignRuleTrigger | null>(editing?.trigger ?? null);
  const [changeTrigger, setChangeTrigger] = useState(false);
  const [keywords, setKeywords] = useState<string | null>(
    editing && editing.conditions.length > 0 ? editing.conditions[0]!.keywords.join(", ") : null,
  );
  const [actions, setActions] = useState<BuilderAction[]>(
    () => (editing?.actions ?? []).map((action) => ({ uid: nextUid++, action })),
  );
  const [showActionPicker, setShowActionPicker] = useState(openActionPicker);
  const [triggerSearch, setTriggerSearch] = useState("");
  const [actionSearch, setActionSearch] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const automationNames = useMemo(
    () => Object.fromEntries(automations.map((r) => [r.id, r.name])),
    [automations],
  );
  // run_automation candidates: readable rows, never itself (the API refuses
  // self-reference too — belt and suspenders).
  const chainable = useMemo(
    () => automations.filter((r) => !r.invalid && r.id !== editing?.id),
    [automations, editing?.id],
  );

  const isReply = trigger?.kind === "reply_classified";
  const dto: AutomationWrite | null = trigger
    ? {
        name: name.trim(),
        enabled,
        trigger,
        conditions: isReply ? keywordsToConditions(keywords) : [],
        actions: actions.map((a) => a.action),
      }
    : null;
  const valid = dto !== null && automationWriteSchema.safeParse(dto).success;

  // The first blocking reason, owner-readable (the footer hint) — derived
  // from state directly so the gray Save button always says why.
  const blocker = !trigger
    ? "pick a trigger"
    : trigger.kind === "reply_classified" && trigger.intents.length === 0
      ? "pick at least one intent"
      : actions.length === 0
        ? "add at least one action"
        : name.trim().length === 0
          ? "name the automation"
          : isReply && keywords !== null && keywordsToConditions(keywords).length === 0
            ? "add a keyword or remove the filter"
            : actions.some((a) => a.action.kind === "run_automation" && !a.action.automationId)
              ? "pick an automation to run"
              : actions.some((a) => a.action.kind === "add_tag" && !a.action.tag.trim())
                ? "name the tag"
                : actions.some((a) => a.action.kind === "set_stage" && !a.action.stage.trim())
                  ? "name the stage"
                  : null;
  const canSave = valid && !busy;

  const save = async () => {
    if (!canSave || !dto) return;
    setBusy(true);
    setSaveError(null);
    try {
      if (editing) {
        await cf(`automations/${editing.id}`, { method: "PUT", body: JSON.stringify(dto) });
        onSaved("updated");
      } else {
        await cf("automations", { method: "POST", body: JSON.stringify(dto) });
        onSaved("created");
      }
    } catch (err) {
      setSaveError(err instanceof CfError && err.detail ? err.detail : "Couldn't save — try again");
      setBusy(false);
    }
  };

  const updateAction = (uid: number, next: CampaignRuleAction) =>
    setActions((prev) => prev.map((a) => (a.uid === uid ? { ...a, action: next } : a)));
  const moveAction = (uid: number, delta: -1 | 1) =>
    setActions((prev) => {
      const i = prev.findIndex((a) => a.uid === uid);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const pickRecipe = (r: AutomationRecipe) => {
    setTrigger(r.write.trigger);
    setKeywords(r.write.conditions.length > 0 ? r.write.conditions[0]!.keywords.join(", ") : null);
    setActions(r.write.actions.map((action) => ({ uid: nextUid++, action })));
    if (!name.trim()) setName(r.name);
    setChangeTrigger(false);
    setShowActionPicker(false);
  };

  const showRecipes = !editing && !trigger && keywords === null && actions.length === 0;
  const showTriggerPicker = !trigger || changeTrigger;

  // ── picker view-models: the vocabulary + the honest-absent ledger ─────────
  const tq = triggerSearch.trim().toLowerCase();
  const triggerGroups = TRIGGER_PICKER_GROUPS.map((group) => ({
    group,
    items: [
      ...TRIGGER_OPTIONS.filter((o) => TRIGGER_GROUP[o.kind] === group).map((o) => ({
        key: o.kind as string,
        icon: TRIGGER_ICONS[o.kind],
        label: o.label,
        sub: TRIGGER_DESCRIPTIONS[o.kind],
        kind: o.kind as CampaignRuleTriggerKind | null,
      })),
      ...ABSENT_TRIGGERS.filter((a) => a.group === group).map((a) => ({
        key: `absent:${a.label}`,
        icon: a.icon,
        label: a.label,
        sub: a.reason,
        kind: null as CampaignRuleTriggerKind | null,
      })),
    ].filter((i) => !tq || `${i.label} ${i.sub}`.toLowerCase().includes(tq)),
  })).filter((g) => g.items.length > 0);

  const aq = actionSearch.trim().toLowerCase();
  const actionGroups = ACTION_PICKER_GROUPS.map((group) => ({
    group,
    items: [
      ...ACCOUNT_ACTION_OPTIONS.filter((o) => o.group === group).map((o) => {
        const noChain = o.kind === "run_automation" && chainable.length === 0;
        return {
          key: o.kind as string,
          icon: o.icon,
          label: o.label,
          sub: noChain ? "No other automations to chain yet" : o.desc,
          kind: noChain ? null : (o.kind as CampaignRuleActionKind | null),
        };
      }),
      ...ABSENT_ACTIONS.filter((a) => a.group === group).map((a) => ({
        key: `absent:${a.label}`,
        icon: a.icon,
        label: a.label,
        sub: a.reason,
        kind: null as CampaignRuleActionKind | null,
      })),
    ].filter((i) => !aq || `${i.label} ${i.sub}`.toLowerCase().includes(aq)),
  })).filter((g) => g.items.length > 0);

  const summary = `${trigger ? "1 trigger" : "No trigger"} · ${
    isReply && keywords !== null ? 1 : 0
  } filter${isReply && keywords !== null ? "" : "s"} · ${actions.length} action${
    actions.length === 1 ? "" : "s"
  }`;

  const txtRow = (label: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid #F2EEE4", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: "#9AA59E", fontWeight: 700, width: 74, flex: "none" }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...INPUT, flex: 1, minWidth: 0 }} />
    </div>
  );

  return (
    <div data-testid="automation-builder" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, fontFamily: "'Hanken Grotesk',sans-serif" }}>
      <style>{`.builder-input:focus{border-color:#9FD8AC !important;outline:none;} .picker-card:hover{border-color:#36D7ED !important;}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 740, maxWidth: "100%", maxHeight: "100%", background: "#FBF7F0", borderRadius: 18, boxShadow: "0 30px 90px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, flex: "none", background: GRAD, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⟳</span>
          <input
            data-testid="builder-name"
            className="builder-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this automation…"
            style={{ flex: 1, minWidth: 0, fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 19, color: "#0E1512", border: "1px solid transparent", background: "transparent", borderRadius: 9, padding: "6px 8px" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: enabled ? "#16A82A" : "#9AA59E" }}>{enabled ? "On" : "Off"}</span>
            <span data-testid="builder-enabled" onClick={() => setEnabled((v) => !v)} style={{ width: 42, height: 24, borderRadius: 100, background: enabled ? GRAD : "#E4EAE6", position: "relative", display: "inline-block", cursor: "pointer" }}>
              <span style={{ position: "absolute", top: 3, [enabled ? "right" : "left"]: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
            </span>
          </div>
          <span onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: 22 }}>
          {/* recipes — blank & new only (canon) */}
          {showRecipes && (
            <>
              <div style={{ ...GROUP_LABEL, fontSize: 11, letterSpacing: ".07em", color: "#8A7F6B", marginBottom: 10 }}>Quick start from a recipe</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
                {AUTOMATION_RECIPES.map((r, i) => (
                  <div key={r.name} data-testid={`recipe-${i}`} className="picker-card" onClick={() => pickRecipe(r)} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, padding: "12px 14px", cursor: "pointer" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.14)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{r.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <div style={{ height: 1, flex: 1, background: "#EBE3D6" }} />
                <span style={{ fontSize: 12, color: "#9AA59E", fontWeight: 600 }}>or build from scratch</span>
                <div style={{ height: 1, flex: 1, background: "#EBE3D6" }} />
              </div>
            </>
          )}

          {/* WHEN */}
          <div style={{ ...SECTION, color: "#1192A6" }}>When this happens · trigger</div>
          {showTriggerPicker && (
            <>
              <input
                data-testid="trigger-search"
                className="builder-input"
                value={triggerSearch}
                onChange={(e) => setTriggerSearch(e.target.value)}
                placeholder="Search triggers — replies, calls, forms, payments, LinkedIn…"
                style={{ ...INPUT, width: "100%", borderRadius: 10, padding: "10px 13px", marginBottom: 12, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 8 }}>
                {triggerGroups.map((g) => (
                  <div key={g.group}>
                    <div style={{ ...GROUP_LABEL, color: "#1192A6" }}>{g.group}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                      {g.items.map((t) =>
                        t.kind ? (
                          <div
                            key={t.key}
                            data-testid={`trigger-option-${t.kind}`}
                            className="picker-card"
                            onClick={() => {
                              setTrigger(trigger?.kind === t.kind ? trigger : defaultTriggerFor(t.kind!));
                              if (t.kind !== "reply_classified") setKeywords(null);
                              setChangeTrigger(false);
                              setTriggerSearch("");
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: trigger?.kind === t.kind ? "1.5px solid #36D7ED" : "1px solid #EBE3D6", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }}
                          >
                            <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.14)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{t.icon}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{t.label}</div>
                              <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.sub}</div>
                            </div>
                          </div>
                        ) : (
                          <div key={t.key} data-testid="absent-trigger" aria-disabled="true" title={t.sub} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px dashed #E4DDD0", borderRadius: 12, padding: "11px 13px", cursor: "not-allowed", opacity: 0.55 }}>
                            <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "#F2EEE4", color: "#8A7F6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{t.icon}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62" }}>{t.label}</div>
                              <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.sub}</div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {trigger && !changeTrigger && (
            <div style={{ background: "#fff", border: "1px solid rgba(54,215,237,.45)", borderRadius: 13, padding: "14px 16px", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.16)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{TRIGGER_ICONS[trigger.kind]}</span>
                <span data-testid="selected-trigger" style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512", flex: 1 }}>{triggerChip(trigger)}</span>
                <span onClick={() => setChangeTrigger(true)} style={{ fontSize: 12.5, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.12)", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Change</span>
              </div>
              {trigger.kind === "reply_classified" && (
                <div style={{ marginTop: 13, paddingTop: 13, borderTop: "1px solid #F2EEE4", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#9AA59E", fontWeight: 700, width: 74, flex: "none" }}>Intents</span>
                  {REPLY_INTENT_OPTIONS.map((intent) => {
                    const on = trigger.intents.includes(intent);
                    const tint = intentTint(intent);
                    return (
                      <span
                        key={intent}
                        data-testid={`intent-chip-${intent}`}
                        onClick={() =>
                          setTrigger({
                            kind: "reply_classified",
                            intents: on
                              ? trigger.intents.filter((i) => i !== intent)
                              : [...trigger.intents, intent],
                          })
                        }
                        style={{ fontSize: 12.5, fontWeight: 600, color: on ? tint.fg : "#5C6B62", background: on ? tint.bg : "#fff", border: `1px solid ${on ? tint.fg : "#EBE3D6"}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}
                      >
                        {tint.label}
                      </span>
                    );
                  })}
                  {trigger.intents.length === 0 && (
                    <span style={{ fontSize: 12, color: "#C9543F", fontWeight: 600 }}>Pick at least one intent</span>
                  )}
                </div>
              )}
              {trigger.kind === "sequence_quiet" && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13, paddingTop: 13, borderTop: "1px solid #F2EEE4" }}>
                  <span style={{ fontSize: 13, color: "#5C6B62", fontWeight: 600 }}>No reply after</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid #EBE3D6", borderRadius: 10, overflow: "hidden" }}>
                    <span data-testid="days-down" onClick={() => setTrigger({ kind: "sequence_quiet", days: Math.max(1, trigger.days - 1) })} style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F2EA", color: "#0E1512", fontSize: 18, cursor: "pointer" }}>−</span>
                    <span style={{ width: 44, textAlign: "center", fontSize: 14, fontWeight: 700, color: "#0E1512", fontVariantNumeric: "tabular-nums" }}>{trigger.days}</span>
                    <span data-testid="days-up" onClick={() => setTrigger({ kind: "sequence_quiet", days: Math.min(365, trigger.days + 1) })} style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F2EA", color: "#0E1512", fontSize: 18, cursor: "pointer" }}>+</span>
                  </div>
                  <span style={{ fontSize: 13, color: "#5C6B62", fontWeight: 600 }}>days</span>
                </div>
              )}
              {/* INT W2 (DEC-094): before_meeting hours — the sequence_quiet
                  stepper anatomy, clamped to the schema's 1..336. */}
              {trigger.kind === "before_meeting" && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13, paddingTop: 13, borderTop: "1px solid #F2EEE4" }}>
                  <span style={{ fontSize: 13, color: "#5C6B62", fontWeight: 600 }}>Fires</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid #EBE3D6", borderRadius: 10, overflow: "hidden" }}>
                    <span data-testid="hours-down" onClick={() => setTrigger({ kind: "before_meeting", hours: Math.max(1, trigger.hours - 1) })} style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F2EA", color: "#0E1512", fontSize: 18, cursor: "pointer" }}>−</span>
                    <span style={{ width: 44, textAlign: "center", fontSize: 14, fontWeight: 700, color: "#0E1512", fontVariantNumeric: "tabular-nums" }}>{trigger.hours}</span>
                    <span data-testid="hours-up" onClick={() => setTrigger({ kind: "before_meeting", hours: Math.min(336, trigger.hours + 1) })} style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F2EA", color: "#0E1512", fontSize: 18, cursor: "pointer" }}>+</span>
                  </div>
                  <span style={{ fontSize: 13, color: "#5C6B62", fontWeight: 600 }}>hours before the meeting starts</span>
                </div>
              )}
            </div>
          )}

          {trigger && !changeTrigger && (
            <>
              {/* ONLY IF — the ONE engine condition (keyword refinement, reply
                  triggers only); the canon's other 13 fields are honest-absent. */}
              {CONNECTOR}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 9 }}>
                <span style={{ ...SECTION, marginBottom: 0, color: "#8A7F6B", flex: 1 }}>
                  Only if · filters <span style={{ fontWeight: 600, color: "#B7BDB6" }}>(optional)</span>
                </span>
              </div>
              {isReply ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                  {keywords !== null && (
                    <div data-testid="keyword-filter" style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "10px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#F7F2EA", border: "1px solid #EBE3D6", borderRadius: 9, padding: "8px 12px", whiteSpace: "nowrap" }}>Reply contains</span>
                      <input
                        data-testid="keyword-input"
                        className="builder-input"
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="pricing, quote — separate with commas"
                        style={{ ...INPUT, flex: 1, minWidth: 0 }}
                      />
                      <span onClick={() => setKeywords(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#C9543F", fontSize: 12, cursor: "pointer", flex: "none" }}>✕</span>
                    </div>
                  )}
                  {keywords === null && (
                    <span data-testid="add-filter" onClick={() => setKeywords("")} style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 700, color: "#16A82A", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}>+ Add filter</span>
                  )}
                  <span style={{ fontSize: 11.5, color: "#B7BDB6" }}>More filters (status, tags, lists, score…) arrive with future units.</span>
                </div>
              ) : (
                <div data-testid="filters-absent" style={{ fontSize: 12.5, color: "#9AA59E", background: "#fff", border: "1px dashed #E4DDD0", borderRadius: 12, padding: "10px 14px", marginBottom: 8 }}>
                  Filters refine reply triggers only — this trigger fires as-is.
                </div>
              )}

              {/* THEN */}
              {CONNECTOR}
              <div style={{ ...SECTION, color: "#16A82A" }}>Then do this · actions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {actions.map(({ uid, action }) => (
                  <div key={uid} data-testid="builder-action" style={{ background: "#fff", border: "1px solid rgba(53,232,52,.4)", borderRadius: 13, padding: "13px 15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(53,232,52,.14)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{ACTION_ICONS[action.kind]}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", flex: 1 }}>{actionChip(action, automationNames)}</span>
                      <span onClick={() => moveAction(uid, -1)} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", fontSize: 12, cursor: "pointer", flex: "none" }}>↑</span>
                      <span onClick={() => moveAction(uid, 1)} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", fontSize: 12, cursor: "pointer", flex: "none" }}>↓</span>
                      <span data-testid="remove-action" onClick={() => setActions((prev) => prev.filter((a) => a.uid !== uid))} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#C9543F", fontSize: 12, cursor: "pointer", flex: "none" }}>✕</span>
                    </div>
                    {action.kind === "add_tag" &&
                      txtRow("Tag", action.tag, (v) => updateAction(uid, { kind: "add_tag", tag: v }), "hot-lead")}
                    {action.kind === "set_stage" && (
                      <>
                        {txtRow("Stage", action.stage, (v) => updateAction(uid, { ...action, stage: v }), "qualified")}
                        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12, color: "#9AA59E", fontWeight: 700, width: 74, flex: "none" }}>Label</span>
                          <input value={action.label ?? ""} onChange={(e) => updateAction(uid, { kind: "set_stage", stage: action.stage, ...(e.target.value.trim() ? { label: e.target.value } : {}) })} placeholder="Shown on the timeline (optional)" style={{ ...INPUT, flex: 1, minWidth: 0 }} />
                        </div>
                      </>
                    )}
                    {action.kind === "notify_team" &&
                      txtRow("Note", action.note ?? "", (v) => updateAction(uid, { kind: "notify_team", ...(v.trim() ? { note: v } : {}) }), "What should the team know? (optional)")}
                    {action.kind === "run_automation" && (
                      <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid #F2EEE4", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "#9AA59E", fontWeight: 700, width: 74, flex: "none" }}>Automation</span>
                        <select
                          data-testid="chain-select"
                          value={action.automationId}
                          onChange={(e) => updateAction(uid, { kind: "run_automation", automationId: e.target.value })}
                          style={{ ...INPUT, flex: 1, minWidth: 0, fontWeight: 600 }}
                        >
                          {!chainable.some((c) => c.id === action.automationId) && (
                            <option value={action.automationId} disabled>
                              {automationNames[action.automationId] ?? "Pick an automation…"}
                            </option>
                          )}
                          {chainable.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}

                {showActionPicker && (
                  <div style={{ background: "#fff", border: "1.5px solid #9FD8AC", borderRadius: 13, padding: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "#16A82A", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Choose an action</div>
                    <input
                      data-testid="action-search"
                      className="builder-input"
                      value={actionSearch}
                      onChange={(e) => setActionSearch(e.target.value)}
                      placeholder="Search actions — message, enroll, tag, CRM, webhook…"
                      style={{ ...INPUT, width: "100%", borderRadius: 10, padding: "9px 12px", marginBottom: 12, boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 13, maxHeight: 330, overflow: "auto" }}>
                      {actionGroups.map((g) => (
                        <div key={g.group}>
                          <div style={{ ...GROUP_LABEL, color: "#16A82A", letterSpacing: ".05em", marginBottom: 7 }}>{g.group}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {g.items.map((a) =>
                              a.kind ? (
                                <div
                                  key={a.key}
                                  data-testid={`action-option-${a.kind}`}
                                  className="picker-card"
                                  onClick={() => {
                                    setActions((prev) =>
                                      prev.length >= 10
                                        ? prev
                                        : [...prev, { uid: nextUid++, action: defaultActionFor(a.kind!, chainable[0]?.id ?? null) }],
                                    );
                                    setShowActionPicker(false);
                                    setActionSearch("");
                                  }}
                                  style={{ display: "flex", alignItems: "center", gap: 10, background: "#FBFAF7", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 12px", cursor: "pointer" }}
                                >
                                  <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: "rgba(53,232,52,.12)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{a.icon}</span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0E1512" }}>{a.label}</div>
                                    <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.sub}</div>
                                  </div>
                                </div>
                              ) : (
                                <div key={a.key} data-testid="absent-action" aria-disabled="true" title={a.sub} style={{ display: "flex", alignItems: "center", gap: 10, background: "#FBFAF7", border: "1px dashed #E4DDD0", borderRadius: 11, padding: "10px 12px", cursor: "not-allowed", opacity: 0.55 }}>
                                  <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: "#F2EEE4", color: "#8A7F6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{a.icon}</span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "#5C6B62" }}>{a.label}</div>
                                    <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.sub}</div>
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <span
                  data-testid="toggle-action-picker"
                  onClick={() => setShowActionPicker((v) => !v)}
                  style={{ alignSelf: "flex-start", fontSize: 13.5, fontWeight: 700, color: "#16A82A", background: "#fff", border: "1.5px dashed #9FD8AC", borderRadius: 11, padding: "11px 18px", cursor: "pointer" }}
                >
                  {showActionPicker ? "✕ Close action list" : "+ Add action"}
                </span>
              </div>
            </>
          )}
        </div>

        {saveError && (
          <div data-testid="builder-error" style={{ margin: "0 22px 10px", background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {saveError}
          </div>
        )}
        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
          <span data-testid="builder-summary" style={{ fontSize: 12.5, color: "#9AA59E" }}>
            {summary}
            {!canSave && !busy && blocker ? ` — ${blocker}` : ""}
          </span>
          <span onClick={onClose} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
          <span
            data-testid="builder-save"
            onClick={() => void save()}
            style={{ fontSize: 14, fontWeight: 700, color: canSave ? "#0A0F0C" : "#B7BDB6", background: canSave ? GRAD : "#EDEAE2", borderRadius: 11, padding: "10px 22px", cursor: canSave ? "pointer" : "not-allowed", boxShadow: canSave ? "0 6px 16px rgba(53,232,52,.26)" : "none" }}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create automation"}
          </span>
        </div>
      </div>
    </div>
  );
}
