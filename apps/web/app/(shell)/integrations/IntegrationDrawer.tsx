"use client";

/**
 * Integration detail / setup drawer (INT W1-UI) — the canon 460px right drawer
 * from `Integrations.dc.html`, two modes:
 *
 * CONNECTED — honest status pill (probe-backed vocabulary, `statusPill`),
 * Connection card (Account · Last sync · health line · "↻ Sync now" → POST
 * probe), "What's syncing" (channel row + the three notification-kind toggles,
 * full-payload-preserving PATCHes), Scopes, Setup (all-✓ per the prototype),
 * Activity, footer Disconnect (two-click confirm → DELETE) + Settings (jumps
 * to the config step).
 *
 * NOT CONNECTED — the canon wizard (step segments bar; auth → select →
 * summary). BEHAVIOR ADAPTATION vs the prototype (flagged): the prototype
 * simulates connect in-page; real Slack OAuth LEAVES the page at step 1
 * (POST connect → window.location.assign(authorizeUrl)) and returns via the
 * callback route with `?connected=slack`, which re-opens this drawer at
 * step 2. A 422 (platform app credentials absent) renders its `detail`
 * VERBATIM (`data-testid="connect-refused"`) — never a dead button.
 *
 * The Activity section is a DESIGNED ADDITION vs the prototype (no canon
 * anchor): the drawer's audit trail merges IntegrationDelivery rows with the
 * `integration.*` ledger events, newest first, honest empty state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntegrationDto, SlackNotificationKind } from "@clientforce/core";
import { CfError } from "../../../components/sequence/shared";
import {
  CATEGORY_LABELS,
  SLACK_AUTH_PERMS,
  SLACK_SETUP_STEPS,
  SLACK_SYNC_ROWS,
  TILE,
  healthLine,
  notificationOn,
  parseSlackConfig,
  slackConfigPayload,
  statusPill,
  type CatalogEntry,
} from "../../../lib/integrations";
import { cf, relTime } from "./IntegrationsView";

const BRICO = "'Bricolage Grotesque',sans-serif";
const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";
const SECTION: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const RBAC_TITLE = "Owners and admins manage integrations";

type Channel = { id: string; name: string };

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

// ── the drawer ──────────────────────────────────────────────────────────────

export function IntegrationDrawer({ entry, row, bootMode, canManage, onClose, onChanged }: {
  entry: CatalogEntry;
  row: IntegrationDto | null;
  /** "config" = post-OAuth return (`?connected=slack`) — boot at the select step. */
  bootMode: "auto" | "config";
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tile = TILE[entry.tile];
  const config = useMemo(() => parseSlackConfig(row?.config), [row]);

  // Wizard step (1..3) or null = connected mode.
  const [wizStep, setWizStep] = useState<number | null>(() => (bootMode === "config" ? 2 : row ? null : 1));
  const [configOpen, setConfigOpen] = useState(false);

  // Draft config (wizard step 2/3 + the connected-mode Settings panel).
  const [draft, setDraft] = useState<{ channel: Channel | null; toggles: Record<SlackNotificationKind, boolean> }>(() => {
    const cfg = parseSlackConfig(row?.config);
    return {
      channel: cfg.channel ?? null,
      toggles: Object.fromEntries(SLACK_SYNC_ROWS.map((r) => [r.kind, notificationOn(cfg, r.kind)])) as Record<SlackNotificationKind, boolean>,
    };
  });

  // OAuth start (step-1 auth + the revoked Reconnect repair).
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

  // Channel options (wizard step 2 + config panel).
  const [options, setOptions] = useState<Channel[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const data = (await cf(`integrations/${entry.id}/options?kind=channels`)) as { options: Channel[] };
      setOptions(data.options);
    } catch (err) {
      // 502 vendor failures carry an honest detail — render it verbatim.
      setOptionsError(err instanceof CfError && err.detail ? err.detail : "Couldn't load channels — try again");
    } finally {
      setOptionsLoading(false);
    }
  }, [entry.id]);
  const needOptions = wizStep === 2 || configOpen;
  useEffect(() => {
    if (needOptions && options === null && !optionsLoading && !optionsError) void loadOptions();
  }, [needOptions, options, optionsLoading, optionsError, loadOptions]);

  // Save config (wizard finish + Settings panel save).
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveConfig = useCallback(async (): Promise<boolean> => {
    if (saveBusy || !canManage) return false;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const payload = slackConfigPayload(config, {
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
  }, [canManage, config, draft, entry.id, onChanged, saveBusy]);

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

  // Notification toggles (connected mode) — full-payload-preserving PATCH.
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
    // Re-seed the draft from the REAL stored config, then jump to the step.
    setDraft({
      channel: config.channel ?? null,
      toggles: Object.fromEntries(SLACK_SYNC_ROWS.map((r) => [r.kind, notificationOn(config, r.kind)])) as Record<SlackNotificationKind, boolean>,
    });
    setSaveError(null);
    setConfigOpen(true);
  };

  const pill = row ? statusPill(row.status, entry.name) : null;
  const activityItems = activity ? mergeActivity(activity.deliveries, activity.events) : null;

  // ── shared sub-renders ────────────────────────────────────────────────────

  const draftTogglesUI = (
    <div>
      {SLACK_SYNC_ROWS.map((r) => (
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

  // ── body per mode ─────────────────────────────────────────────────────────

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (wizStep !== null) {
    // NOT-CONNECTED WIZARD ----------------------------------------------------
    const segs = [1, 2, 3];
    const stepTitle = wizStep === 1 ? `Authorize ${entry.name}` : wizStep === 2 ? "Alerts" : "Confirm & go live";
    const stepDesc =
      wizStep === 1
        ? `Sign in to ${entry.name} to grant secure access.`
        : wizStep === 2
          ? "Where Clientforce posts updates."
          : "Review what will sync, then connect.";
    const onNotifs = SLACK_SYNC_ROWS.filter((r) => draft.toggles[r.kind]);

    body = (
      <>
        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, marginBottom: 18 }}>{entry.desc}</div>
        <span style={SECTION}>Step {wizStep} of 3</span>
        <div style={{ display: "flex", gap: 5, margin: "8px 0 18px" }}>
          {segs.map((s) => (
            <span key={s} style={{ flex: 1, height: 5, borderRadius: 100, background: s <= wizStep ? "#16A82A" : "#E4EAE6" }} />
          ))}
        </div>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512" }}>{stepTitle}</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 16 }}>{stepDesc}</div>

        {wizStep === 1 && (
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
            {connectError && (
              // Honest-absence rail: the 422 NOT_CONFIGURED detail renders verbatim.
              <div data-testid="connect-refused" style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F", marginBottom: 16 }}>
                {connectError}
              </div>
            )}
            <div style={SECTION}>Clientforce will be able to</div>
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
              {SLACK_AUTH_PERMS.map((pm, i) => (
                <div key={pm} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: i === 0 ? "none" : "1px solid #F2EEE4" }}>
                  <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                  <span style={{ fontSize: 13, color: "#3B463F" }}>{pm}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {wizStep === 2 && (
          <>
            {channelPickerUI}
            {draftTogglesUI}
          </>
        )}

        {wizStep === 3 && (
          <>
            <div style={SECTION}>What will sync</div>
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
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
    const canContinue = wizStep !== 2 || draft.channel !== null;
    footer = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
        <span
          data-testid="wiz-back"
          onClick={() => (wizStep > 1 ? setWizStep(wizStep - 1) : onClose())}
          style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}
        >
          {backLabel}
        </span>
        {wizStep === 1 ? (
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
              if (!canContinue || saveBusy) return;
              if (wizStep === 2) setWizStep(3);
              else
                void saveConfig().then((ok) => {
                  if (ok) setWizStep(null); // flip to connected mode
                });
            }}
            aria-disabled={canContinue ? undefined : "true"}
            title={canContinue ? undefined : "Pick a channel first"}
            style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: canContinue && !saveBusy ? "pointer" : "not-allowed", opacity: canContinue && !saveBusy ? 1 : 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}
          >
            {wizStep === 2 ? "Continue" : saveBusy ? "Connecting…" : "Finish & connect"}
          </span>
        )}
      </div>
    );
  } else if (configOpen && row) {
    // CONNECTED → SETTINGS / CONFIG STEP -------------------------------------
    body = (
      <>
        <span style={SECTION}>Settings</span>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", marginTop: 8 }}>Alerts</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 16 }}>Where Clientforce posts updates.</div>
        {channelPickerUI}
        {draftTogglesUI}
        {saveError && (
          <div style={{ marginTop: 12, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {saveError}
          </div>
        )}
      </>
    );
    footer = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
        <span onClick={() => setConfigOpen(false)} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
        <span
          data-testid="config-save"
          onClick={() => {
            if (saveBusy || !canManage) return;
            void saveConfig().then((ok) => {
              if (ok) setConfigOpen(false);
            });
          }}
          aria-disabled={canManage ? undefined : "true"}
          title={canManage ? undefined : RBAC_TITLE}
          style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: canManage && !saveBusy ? "pointer" : "not-allowed", opacity: canManage && !saveBusy ? 1 : 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}
        >
          {saveBusy ? "Saving…" : "Save settings"}
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
              onClick={() => void startOAuth()}
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
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
            <span style={{ fontSize: 12.5, color: "#9AA59E", flex: "none" }}>Channel</span>
            <span data-testid="channel-value" style={{ fontSize: 13.5, fontWeight: 600, color: config.channel ? "#0E1512" : "#9AA59E", flex: 1, textAlign: "right" }}>
              {config.channel ? `#${config.channel.name}` : "Not picked yet"}
            </span>
            <span data-testid="channel-change" onClick={openSettings} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }}>Change</span>
          </div>
          {SLACK_SYNC_ROWS.map((r) => {
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

        <div style={SECTION}>Scopes</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {row.scopes.length === 0 && <span style={{ fontSize: 12.5, color: "#9AA59E" }}>No scopes recorded.</span>}
          {row.scopes.map((s) => (
            <span key={s} style={{ fontSize: 12, fontFamily: "monospace", color: "#3B463F", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 8, padding: "4px 9px" }}>{s}</span>
          ))}
        </div>

        <div style={SECTION}>Setup</div>
        {SLACK_SETUP_STEPS.map((st, i) => (
          <div key={st.title} style={{ display: "flex", gap: 13, paddingBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#16A82A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>✓</span>
              {i < SLACK_SETUP_STEPS.length - 1 && <span style={{ flex: 1, width: 2, background: "#EBE3D6", marginTop: 4 }} />}
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
