"use client";

/**
 * Integration detail / setup drawer (INT W1-UI · W2) — the canon 460px right
 * drawer from `Integrations.dc.html`, two modes:
 *
 * CONNECTED — honest status pill (probe-backed vocabulary, `statusPill`),
 * Connection card (Account · Last sync · health line · "↻ Sync now" → POST
 * probe), a per-provider "What's syncing" section (slack: channel row + the
 * three notification-kind toggles, full-payload-preserving PATCHes · gcal:
 * calendar row + the offer-slots toggle · calendly: link row + detection
 * state + the webhook-endpoint row), Scopes, Setup (all-✓ per the
 * prototype), Activity, footer Disconnect (two-click confirm → DELETE) +
 * Settings (jumps to the config step).
 *
 * NOT CONNECTED — the canon wizard (step segments bar). Two shapes:
 *   - OAuth providers (slack, gcal): auth → select → summary. BEHAVIOR
 *     ADAPTATION vs the prototype (flagged): the prototype simulates connect
 *     in-page; real OAuth LEAVES the page at step 1 (POST connect →
 *     window.location.assign(authorizeUrl)) and returns via the callback
 *     route with `?connected=<provider>`, which re-opens this drawer at
 *     step 2. gcal's auth step additionally renders the test-user-mode
 *     disclosure line (DRAWER_CONTENT.gcal.disclosure — mandated copy).
 *   - Fields provider (calendly, INT W2): fields → summary (the canon
 *     `fields` step kind, the SMTP/Twilio flows' anatomy) — "Finish &
 *     connect" POSTs `connect-fields`; its typed 422 refusals (link
 *     unreachable · token tier) render their `detail` VERBATIM.
 * A 422 (platform app credentials absent) renders its `detail` VERBATIM
 * (`data-testid="connect-refused"`) — never a dead button.
 *
 * The Activity section is a DESIGNED ADDITION vs the prototype (no canon
 * anchor): the drawer's audit trail merges IntegrationDelivery rows with the
 * `integration.*` ledger events, newest first, honest empty state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntegrationDto, IntegrationProvider, SlackNotificationKind } from "@clientforce/core";
import { CfError } from "../../../components/sequence/shared";
import {
  CATEGORY_LABELS,
  DRAWER_CONTENT,
  TILE,
  calendlyDetectionState,
  calendlyWebhookPath,
  parseStripeConfig,
  parseWebhooksConfig,
  stripeDetectionState,
  stripeWebhookPath,
  gcalConfigPayload,
  healthLine,
  notificationOn,
  offerSlotsOn,
  parseCalendlyConfig,
  parseGcalConfig,
  parseSlackConfig,
  slackConfigPayload,
  statusPill,
  type CatalogEntry,
  type DrawerContent,
} from "../../../lib/integrations";
import { cf, relTime } from "./IntegrationsView";

const BRICO = "'Bricolage Grotesque',sans-serif";
const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";
const SECTION: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const RBAC_TITLE = "Owners and admins manage integrations";
const FIELD_INPUT: React.CSSProperties = { width: "100%", boxSizing: "border-box", borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512", fontFamily: "inherit", outline: "none" };

type Channel = { id: string; name: string };
/** One options-endpoint row — gcal's `calendars` kind rides `timeZone` along. */
type OptionRow = { id: string; name: string; timeZone?: string };

// ── activity merge (pure, tested) ───────────────────────────────────────────

export type ActivityDelivery = { id: string; kind: string; status: string; detail: unknown; createdAt: string };
export type ActivityEvent = { id: string; type: string; payload: unknown; occurredAt: string };
export type ActivityItem = { id: string; text: string; sub: string | null; at: string; tone: "ok" | "bad" | "neutral" };

/** Merge delivery rows + integration.* ledger rows, newest first (verbatim text). */
export function mergeActivity(deliveries: ActivityDelivery[], events: ActivityEvent[]): ActivityItem[] {
  const tone = (status: string): ActivityItem["tone"] =>
    status === "sent" || status === "ok" || status === "delivered"
      ? "ok"
      : status === "failed" || status === "error"
        ? "bad"
        : "neutral";
  const items: ActivityItem[] = [
    ...deliveries.map((d) => ({
      id: `d-${d.id}`,
      text: `${d.kind} — ${d.status}`,
      sub: typeof d.detail === "string" && d.detail.length > 0 ? d.detail : null,
      at: d.createdAt,
      tone: tone(d.status),
    })),
    ...events.map((e) => ({ id: `e-${e.id}`, text: e.type, sub: null, at: e.occurredAt, tone: "neutral" as const })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

const TONE_STYLE: Record<ActivityItem["tone"], { icon: string; bg: string; fg: string }> = {
  ok: { icon: "✓", bg: "rgba(53,232,52,.14)", fg: "#16A82A" },
  bad: { icon: "!", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  neutral: { icon: "•", bg: "#F2EEE4", fg: "#5C6B62" },
};

// ── small shared atoms ──────────────────────────────────────────────────────

function ToggleSwitch({ on, busy, disabled, title, onToggle }: { on: boolean; busy?: boolean; disabled?: boolean; title?: string; onToggle?: () => void }) {
  return (
    <span
      onClick={disabled || busy ? undefined : onToggle}
      title={title}
      style={{ width: 38, height: 22, borderRadius: 100, background: on ? GRAD : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1 }}
    >
      <span style={{ position: "absolute", top: 3, [on ? "right" : "left"]: 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </span>
  );
}

function ChannelPicker({ options, loading, error, value, disabled, onPick, onRetry }: {
  options: Channel[] | null;
  loading: boolean;
  error: string | null;
  value: Channel | null;
  disabled: boolean;
  onPick: (c: Channel) => void;
  onRetry: () => void;
}) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>Channel</label>
      {loading && (
        <div style={{ borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#9AA59E" }}>Loading channels…</div>
      )}
      {error && !loading && (
        <div data-testid="channels-error" style={{ borderRadius: 11, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", padding: "11px 14px", fontSize: 13, color: "#C9543F", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          <span onClick={onRetry} style={{ fontWeight: 700, cursor: "pointer", flex: "none", textDecoration: "underline" }}>Retry</span>
        </div>
      )}
      {options && !loading && !error && (
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, overflow: "auto", maxHeight: 180 }}>
          {options.length === 0 && (
            <div style={{ padding: "11px 14px", fontSize: 13, color: "#9AA59E" }}>No public channels found in this workspace.</div>
          )}
          {options.map((c, i) => {
            const on = value?.id === c.id;
            return (
              <div
                key={c.id}
                data-testid={`channel-${c.id}`}
                onClick={disabled ? undefined : () => onPick(c)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid #F2EEE4", cursor: disabled ? "not-allowed" : "pointer", background: on ? "rgba(53,232,52,.08)" : "transparent" }}
              >
                <span style={{ fontSize: 14, fontWeight: on ? 700 : 600, color: "#0E1512", flex: 1 }}>#{c.name}</span>
                {on && <span style={{ color: "#16A82A", fontSize: 13, fontWeight: 700 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** INT W2: the gcal calendar picker — ChannelPicker's anatomy, rendering the
 *  calendar name + its OWN timeZone (calendarList truth, stored at pick time). */
function CalendarPicker({ options, loading, error, value, disabled, onPick, onRetry }: {
  options: OptionRow[] | null;
  loading: boolean;
  error: string | null;
  value: { id: string } | null;
  disabled: boolean;
  onPick: (c: OptionRow) => void;
  onRetry: () => void;
}) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>Calendar</label>
      {loading && (
        <div style={{ borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#9AA59E" }}>Loading calendars…</div>
      )}
      {error && !loading && (
        <div data-testid="calendars-error" style={{ borderRadius: 11, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", padding: "11px 14px", fontSize: 13, color: "#C9543F", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          <span onClick={onRetry} style={{ fontWeight: 700, cursor: "pointer", flex: "none", textDecoration: "underline" }}>Retry</span>
        </div>
      )}
      {options && !loading && !error && (
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, overflow: "auto", maxHeight: 180 }}>
          {options.length === 0 && (
            <div style={{ padding: "11px 14px", fontSize: 13, color: "#9AA59E" }}>No calendars found on this Google account.</div>
          )}
          {options.map((c, i) => {
            const on = value?.id === c.id;
            return (
              <div
                key={c.id}
                data-testid={`calendar-${c.id}`}
                onClick={disabled ? undefined : () => onPick(c)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid #F2EEE4", cursor: disabled ? "not-allowed" : "pointer", background: on ? "rgba(53,232,52,.08)" : "transparent" }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: on ? 700 : 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {c.timeZone && <span style={{ display: "block", fontSize: 11.5, color: "#9AA59E" }}>{c.timeZone}</span>}
                </span>
                {on && <span style={{ color: "#16A82A", fontSize: 13, fontWeight: 700, flex: "none" }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── the drawer ──────────────────────────────────────────────────────────────

export function IntegrationDrawer({ entry, provider, row, bootMode, canManage, onClose, onChanged }: {
  entry: CatalogEntry;
  /** The LIVE core provider this drawer renders — picks its DRAWER_CONTENT. */
  provider: IntegrationProvider;
  row: IntegrationDto | null;
  /** "config" = post-OAuth return (`?connected=<provider>`) — boot at the select step. */
  bootMode: "auto" | "config";
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tile = TILE[entry.tile];
  // Per-provider drawer content — a W2 provider without an entry is a compile
  // error in lib/integrations.ts, never Slack copy silently rendered here.
  // (Annotated to the interface: the satisfies-narrowed union would refuse
  // access to fields only some providers carry, e.g. `disclosure`.)
  const content: DrawerContent = DRAWER_CONTENT[provider];
  const isSlack = provider === "slack";
  const isGcal = provider === "gcal";
  const isCalendly = provider === "calendly";
  // INT W3 (DEC-095): the payments + outbound-webhooks providers.
  const isStripe = provider === "stripe";
  const isWebhooks = provider === "webhooks";
  // The slack-typed content (narrow syncRows kinds) for the toggle machinery.
  const slackContent = DRAWER_CONTENT.slack;
  const config = useMemo(() => parseSlackConfig(row?.config), [row]);
  const gcalConfig = useMemo(() => parseGcalConfig(row?.config), [row]);
  const calConfig = useMemo(() => parseCalendlyConfig(row?.config), [row]);
  const detection = calendlyDetectionState(calConfig);
  const stripeCfg = useMemo(() => parseStripeConfig(row?.config), [row]);
  const stripeDetection = stripeDetectionState(stripeCfg);
  const whCfg = useMemo(() => parseWebhooksConfig(row?.config), [row]);

  // Wizard step (1..3 oauth · 1..2 fields) or null = connected mode.
  const [wizStep, setWizStep] = useState<number | null>(() => (bootMode === "config" ? 2 : row ? null : 1));
  const [configOpen, setConfigOpen] = useState(false);

  // Draft config (wizard config step + the connected-mode Settings panel).
  const [draft, setDraft] = useState<{ channel: Channel | null; toggles: Record<SlackNotificationKind, boolean> }>(() => {
    const cfg = parseSlackConfig(row?.config);
    return {
      channel: cfg.channel ?? null,
      toggles: Object.fromEntries(slackContent.syncRows.map((r) => [r.kind, notificationOn(cfg, r.kind)])) as Record<SlackNotificationKind, boolean>,
    };
  });
  // INT W2: the gcal draft (calendar pick + offer-slots) — same seeding rules.
  const [gcalDraft, setGcalDraft] = useState<{ calendar: { id: string; name: string; timeZone: string } | null; offerSlots: boolean }>(() => {
    const cfg = parseGcalConfig(row?.config);
    return { calendar: cfg.calendar ?? null, offerSlots: offerSlotsOn(cfg) };
  });
  // INT W2: the calendly fields form (the token is write-only — never echoed).
  const [fields, setFields] = useState<{ schedulingUrl: string; apiToken: string }>(() => {
    const cfg = parseCalendlyConfig(row?.config);
    return { schedulingUrl: cfg.schedulingUrl ?? "", apiToken: "" };
  });
  // INT W3: the stripe fields form (the key is write-only — never echoed).
  const [stripeFields, setStripeFields] = useState<{ paymentLinkUrl: string; apiKey: string }>(() => {
    const cfg = parseStripeConfig(row?.config);
    return { paymentLinkUrl: cfg.paymentLinkUrl ?? "", apiKey: "" };
  });
  // INT W3: the webhooks fields form (the secret is server-minted, not typed).
  const [whFields, setWhFields] = useState<{ defaultUrl: string }>(() => {
    const cfg = parseWebhooksConfig(row?.config);
    return { defaultUrl: cfg.defaultUrl ?? "" };
  });

  // One-shot draft re-seed for the post-OAuth boot (`?connected=<provider>`):
  // the drawer mounts BEFORE the polled row lands (row null → row), so the
  // mount-time seed above saw only defaults. When the row first arrives after
  // a null-row mount, re-seed the drafts ONCE from the REAL stored config —
  // otherwise "Finish & connect" would PATCH the default full payload and
  // clobber a previously stored channel / toggle opt-outs on reconnect. Never
  // re-runs after that, so later user edits are never clobbered.
  const [draftSeeded, setDraftSeeded] = useState(row !== null);
  useEffect(() => {
    if (draftSeeded || !row) return;
    setDraftSeeded(true);
    setDraft({
      channel: config.channel ?? null,
      toggles: Object.fromEntries(slackContent.syncRows.map((r) => [r.kind, notificationOn(config, r.kind)])) as Record<SlackNotificationKind, boolean>,
    });
    setGcalDraft({ calendar: gcalConfig.calendar ?? null, offerSlots: offerSlotsOn(gcalConfig) });
    setFields({ schedulingUrl: calConfig.schedulingUrl ?? "", apiToken: "" });
    setStripeFields({ paymentLinkUrl: stripeCfg.paymentLinkUrl ?? "", apiKey: "" });
    setWhFields({ defaultUrl: whCfg.defaultUrl ?? "" });
  }, [draftSeeded, row, config, gcalConfig, calConfig, stripeCfg, whCfg, slackContent.syncRows]);

  // OAuth start (step-1 auth + the revoked Reconnect repair — oauth providers).
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const startOAuth = useCallback(async () => {
    if (connectBusy || !canManage) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const data = (await cf(`integrations/${entry.id}/connect`, { method: "POST" })) as { authorizeUrl: string };
      window.location.assign(data.authorizeUrl); // leaves the page — busy stays on
    } catch (err) {
      setConnectError(err instanceof CfError && err.detail ? err.detail : "Couldn't start the connect flow — try again");
      setConnectBusy(false);
    }
  }, [canManage, connectBusy, entry.id]);

  // INT W2: the calendly connect-fields POST (both tiers; typed 422 verbatim).
  const [fieldsBusy, setFieldsBusy] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const connectFields = useCallback(async (): Promise<boolean> => {
    if (fieldsBusy || !canManage) return false;
    setFieldsBusy(true);
    setFieldsError(null);
    try {
      // INT W3: three fields providers, one endpoint — per-provider bodies.
      let body: Record<string, string>;
      if (isStripe) {
        body = {};
        if (stripeFields.paymentLinkUrl.trim()) body.paymentLinkUrl = stripeFields.paymentLinkUrl.trim();
        if (stripeFields.apiKey.trim()) body.apiKey = stripeFields.apiKey.trim();
      } else if (isWebhooks) {
        body = { defaultUrl: whFields.defaultUrl.trim() };
      } else {
        body = {};
        if (fields.schedulingUrl.trim()) body.schedulingUrl = fields.schedulingUrl.trim();
        if (fields.apiToken.trim()) body.apiToken = fields.apiToken.trim();
      }
      await cf(`integrations/${entry.id}/connect-fields`, { method: "POST", body: JSON.stringify(body) });
      onChanged();
      return true;
    } catch (err) {
      // The typed refusals (link unreachable · token tier) render VERBATIM.
      setFieldsError(err instanceof CfError && err.detail ? err.detail : "Couldn't connect — try again");
      return false;
    } finally {
      setFieldsBusy(false);
    }
  }, [canManage, entry.id, fields, stripeFields, whFields, isStripe, isWebhooks, fieldsBusy, onChanged]);

  // Options (wizard config step + config panel) — slack channels · gcal calendars.
  const [options, setOptions] = useState<OptionRow[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const loadOptions = useCallback(async () => {
    if (content.optionsKind === null) return;
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const data = (await cf(`integrations/${entry.id}/options?kind=${content.optionsKind}`)) as { options: OptionRow[] };
      setOptions(data.options);
    } catch (err) {
      // 502 vendor failures carry an honest detail — render it verbatim.
      setOptionsError(err instanceof CfError && err.detail ? err.detail : `Couldn't load ${content.optionsKind} — try again`);
    } finally {
      setOptionsLoading(false);
    }
  }, [entry.id, content.optionsKind]);
  const needOptions = content.optionsKind !== null && (wizStep === 2 || configOpen) && !isCalendly;
  useEffect(() => {
    if (needOptions && options === null && !optionsLoading && !optionsError) void loadOptions();
  }, [needOptions, options, optionsLoading, optionsError, loadOptions]);

  // Save config (wizard finish + Settings panel save — slack/gcal PATCH).
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveConfig = useCallback(async (): Promise<boolean> => {
    if (saveBusy || !canManage) return false;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const payload = isGcal
        ? gcalConfigPayload(gcalConfig, {
            ...(gcalDraft.calendar ? { calendar: gcalDraft.calendar } : {}),
            offerSlots: gcalDraft.offerSlots,
          })
        : slackConfigPayload(config, {
            ...(draft.channel ? { channel: draft.channel } : {}),
            notifications: draft.toggles,
          });
      await cf(`integrations/${entry.id}`, { method: "PATCH", body: JSON.stringify({ config: payload }) });
      onChanged();
      return true;
    } catch (err) {
      setSaveError(err instanceof CfError && err.detail ? err.detail : "Couldn't save — try again");
      return false;
    } finally {
      setSaveBusy(false);
    }
  }, [canManage, config, draft, entry.id, gcalConfig, gcalDraft, isGcal, onChanged, saveBusy]);

  // Probe ("↻ Sync now").
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const syncNow = useCallback(async () => {
    if (probeBusy || !canManage) return;
    setProbeBusy(true);
    setProbeMsg(null);
    setProbeErr(null);
    try {
      const res = (await cf(`integrations/${entry.id}/probe`, { method: "POST" })) as { status: string; detail: string };
      setProbeMsg(res.detail); // verbatim probe outcome
      onChanged(); // status/lastProbeAt update in place via the list refetch
    } catch (err) {
      setProbeErr(err instanceof CfError && err.detail ? err.detail : "Probe failed — try again");
    } finally {
      setProbeBusy(false);
    }
  }, [canManage, entry.id, onChanged, probeBusy]);

  // Notification toggles (slack connected mode) — full-payload-preserving PATCH.
  const [toggleBusy, setToggleBusy] = useState<SlackNotificationKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toggleKind = useCallback(
    async (kind: SlackNotificationKind) => {
      if (!row || toggleBusy || !canManage) return;
      setToggleBusy(kind);
      setActionError(null);
      try {
        const payload = slackConfigPayload(config, { notifications: { [kind]: !notificationOn(config, kind) } });
        await cf(`integrations/${entry.id}`, { method: "PATCH", body: JSON.stringify({ config: payload }) });
        onChanged();
      } catch (err) {
        setActionError(err instanceof CfError && err.detail ? err.detail : "Couldn't update — try again");
      } finally {
        setToggleBusy(null);
      }
    },
    [canManage, config, entry.id, onChanged, row, toggleBusy],
  );

  // INT W2: the gcal offer-slots toggle (connected mode) — calendar-preserving.
  const [slotsBusy, setSlotsBusy] = useState(false);
  const toggleOfferSlots = useCallback(async () => {
    if (!row || slotsBusy || !canManage) return;
    setSlotsBusy(true);
    setActionError(null);
    try {
      const payload = gcalConfigPayload(gcalConfig, { offerSlots: !offerSlotsOn(gcalConfig) });
      await cf(`integrations/${entry.id}`, { method: "PATCH", body: JSON.stringify({ config: payload }) });
      onChanged();
    } catch (err) {
      setActionError(err instanceof CfError && err.detail ? err.detail : "Couldn't update — try again");
    } finally {
      setSlotsBusy(false);
    }
  }, [canManage, entry.id, gcalConfig, onChanged, row, slotsBusy]);

  // INT W2: copy affordances (calendly link + webhook endpoint).
  const [copied, setCopied] = useState<string | null>(null);
  const copyText = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
  };

  // Disconnect (two-click confirm → DELETE).
  const [discArmed, setDiscArmed] = useState(false);
  const [discBusy, setDiscBusy] = useState(false);
  const disconnect = useCallback(async () => {
    if (!canManage || discBusy) return;
    if (!discArmed) {
      setDiscArmed(true);
      return;
    }
    setDiscBusy(true);
    setActionError(null);
    try {
      await cf(`integrations/${entry.id}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (err) {
      setActionError(err instanceof CfError && err.detail ? err.detail : "Couldn't disconnect — try again");
      setDiscBusy(false);
      setDiscArmed(false);
    }
  }, [canManage, discArmed, discBusy, entry.id, onChanged, onClose]);

  // Activity trail (designed addition — see header comment). Poll while open.
  const [activity, setActivity] = useState<{ deliveries: ActivityDelivery[]; events: ActivityEvent[] } | null>(null);
  const [activityError, setActivityError] = useState(false);
  const connectedMode = wizStep === null && row !== null;
  useEffect(() => {
    if (!connectedMode) return;
    let live = true;
    const fetchActivity = async () => {
      try {
        const data = (await cf(`integrations/${entry.id}/activity`)) as { deliveries: ActivityDelivery[]; events: ActivityEvent[] };
        if (live) {
          setActivity(data);
          setActivityError(false);
        }
      } catch {
        if (live) setActivityError(true);
      }
    };
    void fetchActivity();
    const t = setInterval(() => void fetchActivity(), 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connectedMode, entry.id]);

  const openSettings = () => {
    // Re-seed the drafts from the REAL stored config, then jump to the step.
    setDraft({
      channel: config.channel ?? null,
      toggles: Object.fromEntries(slackContent.syncRows.map((r) => [r.kind, notificationOn(config, r.kind)])) as Record<SlackNotificationKind, boolean>,
    });
    setGcalDraft({ calendar: gcalConfig.calendar ?? null, offerSlots: offerSlotsOn(gcalConfig) });
    setFields({ schedulingUrl: calConfig.schedulingUrl ?? "", apiToken: "" });
    // W3 fix: stripe/webhooks drafts must re-seed from the stored config too —
    // otherwise a cancelled edit persists in state and a later Save re-submits
    // the abandoned value (and connectFields fires a signed test at it).
    setStripeFields({ paymentLinkUrl: stripeCfg.paymentLinkUrl ?? "", apiKey: "" });
    setWhFields({ defaultUrl: whCfg.defaultUrl ?? "" });
    setSaveError(null);
    setFieldsError(null);
    setConfigOpen(true);
  };

  const pill = row ? statusPill(row.status, entry.name) : null;
  const activityItems = activity ? mergeActivity(activity.deliveries, activity.events) : null;

  // ── shared sub-renders ────────────────────────────────────────────────────

  const draftTogglesUI = (
    <div>
      {slackContent.syncRows.map((r) => (
        <div key={r.kind} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px", background: "#fff", marginTop: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>{r.label}</span>
          <ToggleSwitch
            on={draft.toggles[r.kind]}
            disabled={!canManage}
            title={canManage ? undefined : RBAC_TITLE}
            onToggle={() => setDraft((d) => ({ ...d, toggles: { ...d.toggles, [r.kind]: !d.toggles[r.kind] } }))}
          />
        </div>
      ))}
    </div>
  );

  const channelPickerUI = (
    <ChannelPicker
      options={options}
      loading={optionsLoading}
      error={optionsError}
      value={draft.channel}
      disabled={!canManage}
      onPick={(c) => setDraft((d) => ({ ...d, channel: c }))}
      onRetry={() => {
        setOptions(null);
        setOptionsError(null);
      }}
    />
  );

  // INT W2: gcal config UI (wizard step 2 + Settings) — picker + slots toggle.
  const gcalConfigUI = (
    <>
      <CalendarPicker
        options={options}
        loading={optionsLoading}
        error={optionsError}
        value={gcalDraft.calendar}
        disabled={!canManage}
        onPick={(c) =>
          // timeZone rides the calendars options contract; UTC is a defensive
          // fallback only — the picker row itself renders the vendor value.
          setGcalDraft((d) => ({ ...d, calendar: { id: c.id, name: c.name, timeZone: c.timeZone ?? "UTC" } }))
        }
        onRetry={() => {
          setOptions(null);
          setOptionsError(null);
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px", background: "#fff", marginTop: 4 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>Offer open slots in composed copy</span>
        <ToggleSwitch
          on={gcalDraft.offerSlots}
          disabled={!canManage}
          title={canManage ? undefined : RBAC_TITLE}
          onToggle={() => setGcalDraft((d) => ({ ...d, offerSlots: !d.offerSlots }))}
        />
      </div>
      {/* The honest W2 stance: slots are informational, the LINK books. */}
      <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 8, lineHeight: 1.45 }}>
        Slots in copy are informational — the booking link is the booking mechanism.
      </div>
    </>
  );

  // INT W2: calendly fields UI (wizard step 1 + Settings) — canon fields step.
  const calendlyFieldsUI = (
    <>
      <div style={{ marginBottom: 13 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>Scheduling link</label>
        <input
          data-testid="calendly-url"
          value={fields.schedulingUrl}
          disabled={!canManage}
          onChange={(e) => setFields((f) => ({ ...f, schedulingUrl: e.target.value }))}
          placeholder="https://calendly.com/you/intro-call"
          style={FIELD_INPUT}
        />
      </div>
      <div style={{ marginBottom: 13 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>
          API token <span style={{ fontWeight: 600, color: "#9AA59E" }}>(optional)</span>
        </label>
        <input
          data-testid="calendly-token"
          type="password"
          value={fields.apiToken}
          disabled={!canManage}
          onChange={(e) => setFields((f) => ({ ...f, apiToken: e.target.value }))}
          placeholder="Personal access token — paid plans"
          style={FIELD_INPUT}
        />
      </div>
      <div style={{ fontSize: 12, color: "#9AA59E", lineHeight: 1.5 }}>
        Booking detection needs an API token from Calendly → Integrations → API &amp; Webhooks (paid Calendly
        plans). The scheduling link works without it.
      </div>
    </>
  );

  // INT W3 (DEC-095): stripe fields UI — the calendly two-tier twin.
  const stripeFieldsUI = (
    <>
      <div style={{ marginBottom: 13 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>Payment Link</label>
        <input
          data-testid="stripe-link"
          value={stripeFields.paymentLinkUrl}
          disabled={!canManage}
          onChange={(e) => setStripeFields((f) => ({ ...f, paymentLinkUrl: e.target.value }))}
          placeholder="https://buy.stripe.com/…"
          style={FIELD_INPUT}
        />
      </div>
      <div style={{ marginBottom: 13 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>
          Restricted API key <span style={{ fontWeight: 600, color: "#9AA59E" }}>(optional)</span>
        </label>
        <input
          data-testid="stripe-key"
          type="password"
          value={stripeFields.apiKey}
          disabled={!canManage}
          onChange={(e) => setStripeFields((f) => ({ ...f, apiKey: e.target.value }))}
          placeholder="rk_live_… — needs Webhook Endpoints write"
          style={FIELD_INPUT}
        />
      </div>
      <div style={{ fontSize: 12, color: "#9AA59E", lineHeight: 1.5 }}>
        Payment detection needs a restricted key from Stripe → Developers → API keys with Webhook Endpoints
        write. The payment link works without it.
      </div>
    </>
  );

  // INT W3: webhooks fields UI — Payload URL only; the signing secret is
  // server-minted and shown on the connected drawer, never typed here.
  const webhooksFieldsUI = (
    <>
      <div style={{ marginBottom: 13 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 }}>Payload URL</label>
        <input
          data-testid="webhooks-url"
          value={whFields.defaultUrl}
          disabled={!canManage}
          onChange={(e) => setWhFields({ defaultUrl: e.target.value })}
          placeholder="https://api.yoursite.com/cf/webhook"
          style={FIELD_INPUT}
        />
      </div>
      <div style={{ fontSize: 12, color: "#9AA59E", lineHeight: 1.5 }}>
        A public https endpoint you operate — Clientforce sends a SIGNED test delivery on connect; a 2xx from
        your receiver confirms it. Private and internal addresses are refused by the delivery guard.
      </div>
    </>
  );

  // ── body per mode ─────────────────────────────────────────────────────────

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (wizStep !== null) {
    // NOT-CONNECTED WIZARD ----------------------------------------------------
    const segCount = content.mode === "fields" ? 2 : 3;
    const segs = Array.from({ length: segCount }, (_, i) => i + 1);
    const stepTitle =
      content.mode === "fields"
        ? wizStep === 1
          ? `Your ${entry.name} details`
          : "Confirm & go live"
        : wizStep === 1
          ? `Authorize ${entry.name}`
          : wizStep === 2
            ? isGcal
              ? "Calendar settings"
              : "Alerts"
            : "Confirm & go live";
    const stepDesc =
      content.mode === "fields"
        ? wizStep === 1
          ? isStripe
            ? "Paste your Stripe Payment Link — add a restricted API key to detect payments."
            : isWebhooks
              ? "Set the Payload URL Clientforce will POST signed events to."
              : "Paste your scheduling link — add an API token to detect bookings."
          : "Review what will connect."
        : wizStep === 1
          ? `Sign in to ${entry.name} to grant secure access.`
          : wizStep === 2
            ? isGcal
              ? "Where booked calls land."
              : "Where Clientforce posts updates."
            : "Review what will sync, then connect.";
    const onNotifs = slackContent.syncRows.filter((r) => draft.toggles[r.kind]);

    body = (
      <>
        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, marginBottom: 18 }}>{entry.desc}</div>
        <span style={SECTION}>Step {wizStep} of {segCount}</span>
        <div style={{ display: "flex", gap: 5, margin: "8px 0 18px" }}>
          {segs.map((s) => (
            <span key={s} style={{ flex: 1, height: 5, borderRadius: 100, background: s <= wizStep ? "#16A82A" : "#E4EAE6" }} />
          ))}
        </div>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512" }}>{stepTitle}</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 16 }}>{stepDesc}</div>

        {content.mode === "oauth" && wizStep === 1 && (
          <>
            <div
              data-testid="oauth-signin"
              onClick={() => void startOAuth()}
              aria-disabled={canManage ? undefined : "true"}
              title={canManage ? undefined : RBAC_TITLE}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#0C140F", color: "#fff", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: canManage ? "pointer" : "not-allowed", opacity: canManage && !connectBusy ? 1 : 0.6, marginBottom: 16 }}
            >
              <span style={{ width: 24, height: 24, borderRadius: 7, background: tile.tilebg, color: tile.tilefg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 13 }}>{entry.glyph}</span>
              {connectBusy ? `Redirecting to ${entry.name}…` : `Sign in with ${entry.name}`}
            </div>
            {/* INT W2: the gcal test-user-mode disclosure — mandated copy,
                rendered unconditionally on the auth step (honest platform
                state; a non-test user gets Google's access_denied banner). */}
            {content.disclosure && (
              <div data-testid="auth-disclosure" style={{ background: "rgba(232,196,91,.14)", border: "1px solid #EBD9A8", borderRadius: 11, padding: "10px 14px", fontSize: 12.5, color: "#8A6D1C", lineHeight: 1.5, marginBottom: 16 }}>
                {content.disclosure}
              </div>
            )}
            {connectError && (
              // Honest-absence rail: the 422 NOT_CONFIGURED detail renders verbatim.
              <div data-testid="connect-refused" style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F", marginBottom: 16 }}>
                {connectError}
              </div>
            )}
            {content.authPerms.length > 0 && (
              <>
                <div style={SECTION}>Clientforce will be able to</div>
                <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
                  {content.authPerms.map((pm, i) => (
                    <div key={pm} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: i === 0 ? "none" : "1px solid #F2EEE4" }}>
                      <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                      <span style={{ fontSize: 13, color: "#3B463F" }}>{pm}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {content.mode === "fields" && wizStep === 1 && (isStripe ? stripeFieldsUI : isWebhooks ? webhooksFieldsUI : calendlyFieldsUI)}

        {content.mode === "oauth" && wizStep === 2 && (isGcal ? gcalConfigUI : (
          <>
            {channelPickerUI}
            {draftTogglesUI}
          </>
        ))}

        {content.mode === "fields" && wizStep === 2 && (
          <>
            <div style={SECTION}>What will connect</div>
            {/* W3 fix: the confirm step must reflect the ACTUAL provider's
                entries — it was hardcoded to calendly, so stripe/webhooks
                connects showed empty "Scheduling link — " calendly copy. */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
              {isStripe ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
                    <span style={{ color: stripeFields.paymentLinkUrl.trim() ? "#16A82A" : "#C9CFC9", fontSize: 13 }}>{stripeFields.paymentLinkUrl.trim() ? "✓" : "○"}</span>
                    <span data-testid="confirm-stripe-link" style={{ fontSize: 13.5, color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {stripeFields.paymentLinkUrl.trim() ? `Payment link — ${stripeFields.paymentLinkUrl.trim()}` : "No payment link — detection only"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                    <span style={{ color: stripeFields.apiKey.trim() ? "#16A82A" : "#C9CFC9", fontSize: 13 }}>{stripeFields.apiKey.trim() ? "✓" : "○"}</span>
                    <span data-testid="confirm-stripe-key" style={{ fontSize: 13.5, color: "#3B463F" }}>
                      {stripeFields.apiKey.trim()
                        ? "Restricted API key supplied — payment detection will be enabled"
                        : "No API key — link only (add one later to detect payments)"}
                    </span>
                  </div>
                </>
              ) : isWebhooks ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
                    <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                    <span data-testid="confirm-webhooks-url" style={{ fontSize: 13.5, color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Payload URL — {whFields.defaultUrl.trim()}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                    <span style={{ color: "#C9CFC9", fontSize: 13 }}>○</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>A signed test event is POSTed on connect — only a 2xx confirms the receiver; the signing secret appears on the drawer.</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
                    <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Scheduling link — {fields.schedulingUrl.trim()}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                    <span style={{ color: fields.apiToken.trim() ? "#16A82A" : "#C9CFC9", fontSize: 13 }}>{fields.apiToken.trim() ? "✓" : "○"}</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>
                      {fields.apiToken.trim()
                        ? "API token supplied — booking detection will be enabled"
                        : "No API token — link only (add one later to detect bookings)"}
                    </span>
                  </div>
                </>
              )}
            </div>
            {fieldsError && (
              <div data-testid="connect-refused" style={{ marginTop: 12, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
                {fieldsError}
              </div>
            )}
          </>
        )}

        {content.mode === "oauth" && wizStep === 3 && (
          <>
            <div style={SECTION}>What will sync</div>
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
              {isGcal ? (
                <>
                  {gcalDraft.calendar && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
                      <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                      <span style={{ fontSize: 13.5, color: "#3B463F" }}>Availability reads from “{gcalDraft.calendar.name}” ({gcalDraft.calendar.timeZone})</span>
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: gcalDraft.calendar ? "1px solid #F2EEE4" : "none" }}>
                    <span style={{ color: gcalDraft.offerSlots ? "#16A82A" : "#C9CFC9", fontSize: 13 }}>{gcalDraft.offerSlots ? "✓" : "○"}</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>
                      {gcalDraft.offerSlots ? "Open slots may appear in composed copy" : "Slots in copy off — the booking link is the mechanism"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                    <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>Calendly puts booked meetings on this calendar</span>
                  </div>
                </>
              ) : (
                <>
                  {draft.channel && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
                      <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                      <span style={{ fontSize: 13.5, color: "#3B463F" }}>Alerts post to #{draft.channel.name}</span>
                    </div>
                  )}
                  {onNotifs.map((r) => (
                    <div key={r.kind} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                      <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                      <span style={{ fontSize: 13.5, color: "#3B463F" }}>{r.label}</span>
                    </div>
                  ))}
                  {onNotifs.length === 0 && (
                    <div style={{ padding: "10px 15px", fontSize: 13, color: "#9AA59E", borderTop: draft.channel ? "1px solid #F2EEE4" : "none" }}>
                      No alerts enabled yet — you can turn them on later.
                    </div>
                  )}
                </>
              )}
            </div>
            {saveError && (
              <div style={{ marginTop: 12, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
                {saveError}
              </div>
            )}
          </>
        )}
      </>
    );

    const backLabel = wizStep > 1 ? "‹ Back" : "Cancel";
    // INT W3: each fields provider gates its own step-1 requirement.
    const fieldsReady = isStripe
      ? stripeFields.paymentLinkUrl.trim().length > 0 || stripeFields.apiKey.trim().length > 0
      : isWebhooks
        ? whFields.defaultUrl.trim().length > 0
        : fields.schedulingUrl.trim().length > 0;
    const canContinue =
      content.mode === "fields"
        ? wizStep !== 1 || fieldsReady
        : wizStep !== 2 || (isGcal ? gcalDraft.calendar !== null : draft.channel !== null);
    const continueBlockedTitle = content.mode === "fields"
      ? isStripe
        ? "Paste your Payment Link (or a restricted key) first"
        : isWebhooks
          ? "Enter your Payload URL first"
          : "Paste your scheduling link first"
      : isGcal
        ? "Pick a calendar first"
        : "Pick a channel first";
    const lastStep = segCount;
    const wizBusy = content.mode === "fields" ? fieldsBusy : saveBusy;
    footer = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
        <span
          data-testid="wiz-back"
          onClick={() => (wizStep > 1 ? setWizStep(wizStep - 1) : onClose())}
          style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}
        >
          {backLabel}
        </span>
        {content.mode === "oauth" && wizStep === 1 ? (
          // The prototype's Continue is the simulated connect; real OAuth makes
          // the primary the sign-in itself (adaptation flagged in the header).
          <span
            data-testid="wiz-primary"
            onClick={() => void startOAuth()}
            aria-disabled={canManage ? undefined : "true"}
            title={canManage ? undefined : RBAC_TITLE}
            style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: canManage ? "pointer" : "not-allowed", opacity: canManage && !connectBusy ? 1 : 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}
          >
            {connectBusy ? "Redirecting…" : `Sign in with ${entry.name}`}
          </span>
        ) : (
          <span
            data-testid="wiz-primary"
            onClick={() => {
              if (!canContinue || wizBusy) return;
              if (wizStep < lastStep) setWizStep(wizStep + 1);
              else if (content.mode === "fields")
                void connectFields().then((ok) => {
                  if (ok) setWizStep(null); // flip to connected mode
                });
              else
                void saveConfig().then((ok) => {
                  if (ok) setWizStep(null); // flip to connected mode
                });
            }}
            aria-disabled={canContinue ? undefined : "true"}
            title={canContinue ? undefined : continueBlockedTitle}
            style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: canContinue && !wizBusy ? "pointer" : "not-allowed", opacity: canContinue && !wizBusy ? 1 : 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}
          >
            {wizStep < lastStep ? "Continue" : wizBusy ? "Connecting…" : "Finish & connect"}
          </span>
        )}
      </div>
    );
  } else if (configOpen && row) {
    // CONNECTED → SETTINGS / CONFIG STEP -------------------------------------
    const settingsTitle = isGcal
      ? "Calendar settings"
      : isCalendly || isStripe || isWebhooks
        ? `Your ${entry.name} details`
        : "Alerts";
    const settingsDesc = isGcal
      ? "Where booked calls land."
      : isCalendly
        ? "Update the link, or add an API token to turn on booking detection."
        : isStripe
          ? "Update the link, or add a restricted API key to turn on payment detection."
          : isWebhooks
            ? "Update the Payload URL — a signed test delivery confirms it."
            : "Where Clientforce posts updates.";
    body = (
      <>
        <span style={SECTION}>Settings</span>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", marginTop: 8 }}>{settingsTitle}</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 16 }}>{settingsDesc}</div>
        {isGcal ? gcalConfigUI : isStripe ? stripeFieldsUI : isWebhooks ? webhooksFieldsUI : isCalendly ? calendlyFieldsUI : (
          <>
            {channelPickerUI}
            {draftTogglesUI}
          </>
        )}
        {(isCalendly || isStripe || isWebhooks) && fieldsError && (
          <div data-testid="connect-refused" style={{ marginTop: 12, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {fieldsError}
          </div>
        )}
        {!isCalendly && saveError && (
          <div style={{ marginTop: 12, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {saveError}
          </div>
        )}
      </>
    );
    // stripe/webhooks save through connectFields (fieldsBusy), same as calendly
    // — only slack/gcal use saveConfig (saveBusy). W3 fix: their Save button
    // never showed a busy state.
    const settingsBusy = isCalendly || isStripe || isWebhooks ? fieldsBusy : saveBusy;
    footer = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
        <span onClick={() => setConfigOpen(false)} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
        <span
          data-testid="config-save"
          onClick={() => {
            if (settingsBusy || !canManage) return;
            const run = isCalendly || isStripe || isWebhooks ? connectFields : saveConfig;
            void run().then((ok) => {
              if (ok) setConfigOpen(false);
            });
          }}
          aria-disabled={canManage ? undefined : "true"}
          title={canManage ? undefined : RBAC_TITLE}
          style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: canManage && !settingsBusy ? "pointer" : "not-allowed", opacity: canManage && !settingsBusy ? 1 : 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}
        >
          {isCalendly ? (settingsBusy ? "Connecting…" : "Save & reconnect") : settingsBusy ? "Saving…" : "Save settings"}
        </span>
      </div>
    );
  } else if (row) {
    // CONNECTED MODE ----------------------------------------------------------
    const health = healthLine(row.status);
    body = (
      <>
        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, marginBottom: 18 }}>{entry.desc}</div>

        {row.status === "revoked" && (
          <div style={{ background: "rgba(224,121,107,.08)", border: "1px solid #F0CFC8", borderRadius: 14, padding: 14, marginBottom: 18 }}>
            <div style={{ fontSize: 13, color: "#C9543F", marginBottom: 10 }}>
              {entry.name} revoked this token — alerts stopped. Reconnect to resume.
            </div>
            <span
              data-testid="reconnect"
              // Fields providers re-connect via the fields form, never OAuth.
              onClick={() => (content.mode === "fields" ? openSettings() : void startOAuth())}
              aria-disabled={canManage ? undefined : "true"}
              title={canManage ? undefined : RBAC_TITLE}
              style={{ display: "inline-block", fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 10, padding: "9px 16px", cursor: canManage ? "pointer" : "not-allowed", opacity: canManage && !connectBusy ? 1 : 0.6 }}
            >
              {connectBusy ? "Redirecting…" : `↻ Reconnect ${entry.name}`}
            </span>
            {connectError && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: "#C9543F" }}>{connectError}</div>
            )}
          </div>
        )}

        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 16, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1 }}>Connection</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: health.color }}>{health.text}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>
            <span style={{ fontSize: 12.5, color: "#9AA59E", flex: 1 }}>Account</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0E1512" }}>{row.accountLabel ?? "—"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>
            <span style={{ fontSize: 12.5, color: "#9AA59E", flex: 1 }}>Last sync</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0E1512" }}>{relTime(row.lastSyncAt)}</span>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span
              data-testid="sync-now"
              onClick={() => void syncNow()}
              aria-disabled={canManage ? undefined : "true"}
              title={canManage ? undefined : RBAC_TITLE}
              style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: canManage && !probeBusy ? "pointer" : "not-allowed", opacity: canManage ? 1 : 0.6 }}
            >
              {probeBusy ? "Syncing…" : "↻ Sync now"}
            </span>
            {probeMsg && <span data-testid="probe-detail" style={{ fontSize: 12, color: "#5C6B62", flex: 1, minWidth: 0 }}>{probeMsg}</span>}
            {probeErr && <span data-testid="probe-error" style={{ fontSize: 12, color: "#C9543F", flex: 1, minWidth: 0 }}>{probeErr}</span>}
          </div>
        </div>

        <div style={SECTION}>What's syncing</div>
        {isSlack && (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
              <span style={{ fontSize: 12.5, color: "#9AA59E", flex: "none" }}>Channel</span>
              <span data-testid="channel-value" style={{ fontSize: 13.5, fontWeight: 600, color: config.channel ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right" }}>
                {config.channel ? `#${config.channel.name}` : "Not picked yet"}
              </span>
              <span data-testid="channel-change" onClick={openSettings} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>Change</span>
            </div>
            {slackContent.syncRows.map((r) => {
              const on = notificationOn(config, r.kind);
              return (
                <div key={r.kind} data-testid={`sync-row-${r.kind}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                  <span style={{ color: on ? "#16A82A" : "#C9CFC9", fontSize: 13, flex: "none" }}>{on ? "✓" : "○"}</span>
                  <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1 }}>{r.label}</span>
                  <ToggleSwitch
                    on={on}
                    busy={toggleBusy === r.kind}
                    disabled={!canManage}
                    title={canManage ? undefined : RBAC_TITLE}
                    onToggle={() => void toggleKind(r.kind)}
                  />
                </div>
              );
            })}
          </div>
        )}
        {isGcal && (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
              <span style={{ fontSize: 12.5, color: "#9AA59E", flex: "none" }}>Calendar</span>
              <span data-testid="calendar-value" style={{ fontSize: 13.5, fontWeight: 600, color: gcalConfig.calendar ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {gcalConfig.calendar ? `${gcalConfig.calendar.name} · ${gcalConfig.calendar.timeZone}` : "Not picked yet"}
              </span>
              <span data-testid="calendar-change" onClick={openSettings} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>Change</span>
            </div>
            {/* Availability's check is honest: it reads only once a calendar
                is picked. The offer-slots toggle is the ONE config switch. */}
            <div data-testid="sync-row-availability" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ color: gcalConfig.calendar ? "#16A82A" : "#C9CFC9", fontSize: 13, flex: "none" }}>{gcalConfig.calendar ? "✓" : "○"}</span>
              <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1 }}>Availability — open slots can appear in composed copy</span>
            </div>
            <div data-testid="sync-row-offer-slots" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ color: offerSlotsOn(gcalConfig) ? "#16A82A" : "#C9CFC9", fontSize: 13, flex: "none" }}>{offerSlotsOn(gcalConfig) ? "✓" : "○"}</span>
              <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1 }}>Offer open slots in composed copy</span>
              <ToggleSwitch
                on={offerSlotsOn(gcalConfig)}
                busy={slotsBusy}
                disabled={!canManage}
                title={canManage ? undefined : RBAC_TITLE}
                onToggle={() => void toggleOfferSlots()}
              />
            </div>
            <div data-testid="sync-row-bookings" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ color: "#16A82A", fontSize: 13, flex: "none" }}>✓</span>
              <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1 }}>Bookings — Calendly puts booked meetings on this calendar</span>
            </div>
          </div>
        )}
        {isCalendly && (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
              <span style={{ fontSize: 12.5, color: "#9AA59E", flex: "none" }}>Scheduling link</span>
              <span data-testid="calendly-link" style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 600, color: calConfig.schedulingUrl ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {calConfig.schedulingUrl ?? "Not saved yet"}
              </span>
              {calConfig.schedulingUrl && (
                <span data-testid="copy-link" onClick={() => copyText("link", calConfig.schedulingUrl!)} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>
                  {copied === "link" ? "Copied ✓" : "Copy"}
                </span>
              )}
            </div>
            {/* The honest two-tier state line — detection is never assumed. */}
            <div data-testid="calendly-detection" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ color: detection.detection ? "#16A82A" : "#C9CFC9", fontSize: 13, flex: "none" }}>{detection.detection ? "✓" : "○"}</span>
              <span style={{ fontSize: 13, color: detection.detection ? "#16A82A" : "#5C6B62", flex: 1, lineHeight: 1.45, fontWeight: detection.detection ? 600 : 400 }}>{detection.line}</span>
              {detection.offerToken && (
                <span data-testid="add-token" onClick={openSettings} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1px solid #9FD8AC", borderRadius: 8, padding: "4px 10px", cursor: "pointer", flex: "none", whiteSpace: "nowrap" }}>＋ Add token</span>
              )}
            </div>
            {calConfig.webhookToken && (
              <div data-testid="calendly-webhook" style={{ padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 4 }}>Webhook endpoint (created automatically)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{calendlyWebhookPath(calConfig.webhookToken)}</span>
                  <span data-testid="copy-webhook" onClick={() => copyText("webhook", calendlyWebhookPath(calConfig.webhookToken!))} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>
                    {copied === "webhook" ? "Copied ✓" : "Copy"}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 4, lineHeight: 1.45 }}>
                  Informational — Calendly posts booking events here; the detection state above is what matters.
                </div>
              </div>
            )}
          </div>
        )}

        {/* INT W3 (DEC-095): stripe — the calendly two-tier anatomy on payments. */}
        {isStripe && (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
              <span style={{ fontSize: 13, color: "#5C6B62", flex: "none" }}>Payment link</span>
              <span data-testid="stripe-payment-link" style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 600, color: stripeCfg.paymentLinkUrl ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {stripeCfg.paymentLinkUrl ?? "Not set"}
              </span>
              {stripeCfg.paymentLinkUrl && (
                <span data-testid="copy-payment-link" onClick={() => copyText("paylink", stripeCfg.paymentLinkUrl!)} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>
                  {copied === "paylink" ? "Copied ✓" : "Copy"}
                </span>
              )}
            </div>
            {/* The honest two-tier state line — detection is never assumed. */}
            <div data-testid="stripe-detection" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ color: stripeDetection.detection ? "#16A82A" : "#C9CFC9", fontSize: 13, flex: "none" }}>{stripeDetection.detection ? "✓" : "○"}</span>
              <span style={{ fontSize: 13, color: stripeDetection.detection ? "#16A82A" : "#5C6B62", flex: 1, lineHeight: 1.45, fontWeight: stripeDetection.detection ? 600 : 400 }}>{stripeDetection.line}</span>
              {stripeDetection.offerKey && (
                <span data-testid="add-key" onClick={openSettings} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1px solid #9FD8AC", borderRadius: 8, padding: "4px 10px", cursor: "pointer", flex: "none", whiteSpace: "nowrap" }}>＋ Add key</span>
              )}
            </div>
            {stripeCfg.webhookToken && (
              <div data-testid="stripe-webhook" style={{ padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 4 }}>Webhook endpoint (created automatically)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripeWebhookPath(stripeCfg.webhookToken)}</span>
                  <span data-testid="copy-stripe-webhook" onClick={() => copyText("stripe-webhook", stripeWebhookPath(stripeCfg.webhookToken!))} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>
                    {copied === "stripe-webhook" ? "Copied ✓" : "Copy"}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 4, lineHeight: 1.45 }}>
                  Informational — Stripe posts checkout events here; the detection state above is what matters.
                </div>
              </div>
            )}
          </div>
        )}

        {/* INT W3: webhooks — the Payload URL + the workspace signing secret. */}
        {isWebhooks && (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
              <span style={{ fontSize: 13, color: "#5C6B62", flex: "none" }}>Payload URL</span>
              <span data-testid="webhooks-default-url" style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 600, color: whCfg.defaultUrl ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {whCfg.defaultUrl ?? "Not set"}
              </span>
              <span data-testid="webhooks-url-change" onClick={openSettings} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>Change</span>
            </div>
            {whCfg.signingSecret && (
              <div data-testid="webhooks-secret" style={{ padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 4 }}>Signing secret — verify every delivery with it</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{whCfg.signingSecret}</span>
                  <span data-testid="copy-secret" onClick={() => copyText("secret", whCfg.signingSecret!)} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>
                    {copied === "secret" ? "Copied ✓" : "Copy"}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 4, lineHeight: 1.45 }}>
                  Deliveries carry X-Clientforce-Signature: t=…,v1=HMAC-SHA256(secret, "t.body").
                </div>
              </div>
            )}
          </div>
        )}

        <div style={SECTION}>Scopes</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {row.scopes.length === 0 && <span style={{ fontSize: 12.5, color: "#9AA59E" }}>No scopes recorded.</span>}
          {row.scopes.map((s) => (
            <span key={s} style={{ fontSize: 12, fontFamily: "monospace", color: "#3B463F", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 8, padding: "4px 9px" }}>{s}</span>
          ))}
        </div>

        <div style={SECTION}>Setup</div>
        {content.setupSteps.map((st, i) => (
          <div key={st.title} style={{ display: "flex", gap: 13, paddingBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#16A82A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>✓</span>
              {i < content.setupSteps.length - 1 && <span style={{ flex: 1, width: 2, background: "#EBE3D6", marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{st.title}</div>
              <div style={{ fontSize: 12.5, color: "#8A7F6B", lineHeight: 1.45, marginTop: 2 }}>{st.desc}</div>
            </div>
          </div>
        ))}

        {/* Activity — designed addition vs the prototype (no canon anchor). */}
        <div style={{ ...SECTION, margin: "18px 0 10px" }}>Activity</div>
        {activityError && <div style={{ fontSize: 13, color: "#C9543F", padding: "9px 0" }}>Couldn't load activity — retrying.</div>}
        {activityItems !== null && activityItems.length === 0 && !activityError && (
          <div data-testid="activity-empty" style={{ fontSize: 13, color: "#9AA59E", padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>No activity yet</div>
        )}
        {(activityItems ?? []).map((a) => {
          const s = TONE_STYLE[a.tone];
          return (
            <div key={a.id} data-testid="activity-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, flex: "none", background: s.bg, color: s.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{s.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</span>
                {a.sub && <span style={{ display: "block", fontSize: 11.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.sub}</span>}
              </span>
              <span style={{ fontSize: 12, color: "#9AA59E", flex: "none" }}>{relTime(a.at)}</span>
            </div>
          );
        })}
      </>
    );
    footer = (
      <>
        {actionError && (
          <div data-testid="action-error" style={{ margin: "0 22px 10px", background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {actionError}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
          <span
            data-testid="drawer-disconnect"
            onClick={() => void disconnect()}
            aria-disabled={canManage ? undefined : "true"}
            title={canManage ? undefined : RBAC_TITLE}
            style={{ fontSize: 14, fontWeight: 600, color: "#C9543F", background: discArmed ? "rgba(224,121,107,.1)" : "#fff", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 18px", cursor: canManage && !discBusy ? "pointer" : "not-allowed", opacity: canManage ? 1 : 0.5 }}
          >
            {discBusy ? "Disconnecting…" : discArmed ? "Really disconnect?" : "Disconnect"}
          </span>
          <span
            data-testid="drawer-settings"
            onClick={openSettings}
            style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}
          >
            Settings
          </span>
        </div>
      </>
    );
  } else {
    // Row vanished mid-open (disconnected elsewhere) — honest fallback into
    // the wizard rather than a stale connected view.
    body = (
      <div style={{ fontSize: 13.5, color: "#5C6B62" }}>
        This integration is not connected.{" "}
        <span onClick={() => setWizStep(1)} style={{ color: "#16A82A", fontWeight: 700, cursor: "pointer" }}>Connect it</span>
      </div>
    );
    footer = null;
  }

  return (
    <div data-testid="integration-drawer" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column", fontFamily: "'Hanken Grotesk',sans-serif" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "20px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
          <span style={{ width: 46, height: 46, borderRadius: 13, flex: "none", background: tile.tilebg, color: tile.tilefg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 19 }}>{entry.glyph}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 18, color: "#0E1512" }}>{entry.name}</div>
            <div style={{ fontSize: 12, color: "#9AA59E", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{CATEGORY_LABELS[entry.cat]}</div>
            <div style={{ marginTop: 7 }}>
              {pill ? (
                <span data-testid="status-pill" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: pill.fg, background: pill.bg, borderRadius: 100, padding: "4px 11px" }}>
                  {pill.pulse && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#35E834", boxShadow: "0 0 0 3px rgba(53,232,52,.25)", flex: "none" }} />}
                  {pill.label}
                </span>
              ) : (
                <span data-testid="status-pill" style={{ fontSize: 12, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "4px 11px" }}>Not connected</span>
              )}
            </div>
          </div>
          <span data-testid="drawer-close" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "18px 22px" }}>{body}</div>

        {footer}
      </div>
    </div>
  );
}
