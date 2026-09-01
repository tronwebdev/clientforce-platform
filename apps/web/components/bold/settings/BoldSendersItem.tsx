"use client";

/**
 * Senders (SURFACE_SPEC_SETTINGS §6) — Email · Numbers · Health.
 *
 * Every row here opens the sender drawer by ID, and the drawer resolves its
 * own detail. That is deliberate: the same drawer opens from three different
 * lists, and the Health tab's rows carry different fields from the Email
 * tab's. Passing the row through would work from one list and throw from
 * another.
 */
import { useState } from "react";
import { AddRow, RowList, type SettingsRow } from "../bold-settings-kit";
import type { BoldSenderRow } from "../bold-live";
import type { NumberRequestRow } from "../bold-settings-live";
import { BoldItemPage, EmptyTab, TabNote, type ItemHeader } from "./BoldItemPage";
import {
  AddEmailSenderDrawer,
  AddNumberDrawer,
  NumberRequestDrawer,
  SenderDrawer,
} from "./BoldSenderDrawers";
import { dnsPosture, emailSenders, pluralise, smsSenders, warmupPercent, type SettingsSnapshot } from "./settings-data";

type Drawer =
  | { t: "sender"; id: string }
  | { t: "addEmail" }
  | { t: "addNumber" }
  | { t: "request"; request: NumberRequestRow };

const TABS = ["Email", "Numbers", "Health"];

function senderSub(s: BoldSenderRow): string {
  const posture = dnsPosture(s);
  const name = s.fromName ? `Sends as ${s.fromName}` : "No from-name yet — sends fail without one";
  const reply = s.replyTo ? ` · replies to ${s.replyTo}` : "";
  const warming = s.warmup?.active ? ` · warming, ${s.warmup.pct}%` : "";
  return `${name}${reply} · ${posture.line}${warming}`;
}

export function BoldSendersItem({
  data,
  reload,
  flash,
  onBack,
  onHeader,
}: {
  data: SettingsSnapshot;
  reload: () => Promise<void>;
  flash: (m: string) => void;
  onBack: () => void;
  onHeader: (h: ItemHeader | null) => void;
}) {
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);

  const senders = data.senders ?? [];
  const email = emailSenders(senders);
  const numbers = smsSenders(senders);
  const requests = (data.numbers ?? []).filter((n) => n.status !== "CANCELLED");
  const pct = warmupPercent(senders);
  const authed = email.filter((s) => dnsPosture(s).state === "verified").length;

  async function done(toast: string) {
    setDrawer(null);
    flash(toast);
    await reload();
  }

  const stats = [
    {
      label: "EMAIL SENDERS",
      value: String(email.length),
      sub:
        email.length === 0
          ? "none yet"
          : authed === email.length
            ? "all authenticated"
            : `${authed} of ${email.length} authenticated`,
      tone: email.length > 0 && authed === email.length ? ("forest" as const) : ("amber" as const),
    },
    {
      label: "NUMBERS",
      value: String(numbers.length),
      sub:
        numbers.length > 0
          ? "sending and receiving"
          : requests.length > 0
            ? `${pluralise(requests.length, "request", "requests")} waiting`
            : "none yet",
      tone: "ink" as const,
    },
    {
      label: "WARM-UP",
      value: pct === null ? "—" : `${pct}%`,
      // No ramp is not 0% — it is nothing to report.
      sub: pct === null ? "not started" : pct >= 100 ? "at full volume" : "still ramping",
      tone: pct !== null && pct < 100 ? ("amber" as const) : ("forest" as const),
    },
  ];

  /* Derived from this page: the sender that most needs a look. */
  const unverified = email.find((s) => dnsPosture(s).state !== "verified");
  const unhealthy = senders.find((s) => s.health?.state === "unhealthy");
  const ramping = senders.find((s) => s.warmup?.active);
  const ada: { note: string | null; actionLabel?: string; onAct?: () => void } = unhealthy
    ? {
        note: `${unhealthy.fromEmail} is showing a health problem. Sending more from it before that clears is how a domain gets burned rather than warmed.`,
        actionLabel: "Open it",
        onAct: () => setDrawer({ t: "sender", id: unhealthy.id }),
      }
    : unverified
      ? {
          note: `${unverified.fromEmail} is not fully authenticated yet — ${dnsPosture(unverified).line.toLowerCase()}. Until it passes, its sends stay held rather than landing in spam.`,
          actionLabel: "See what is missing",
          onAct: () => setDrawer({ t: "sender", id: unverified.id }),
        }
      : ramping
        ? {
            note: `${ramping.fromEmail} is at ${ramping.warmup!.pct}% of its ramp, capped at ${ramping.warmup!.currentCap ?? "its current ceiling"} a day. Holding that pace is what earns the full volume.`,
            actionLabel: "Open it",
            onAct: () => setDrawer({ t: "sender", id: ramping.id }),
          }
        : { note: null };

  const emailRows: SettingsRow[] = email.map((s) => {
    const posture = dnsPosture(s);
    return {
      t: "chip",
      key: s.id,
      // Per-tab tile, not per-status — Console Bold.dc.html:4724-4726.
      ic: "\u2709",
      tint: "mint",
      n: s.fromEmail ?? "This sender",
      sub: senderSub(s),
      chip:
        s.status !== "ACTIVE"
          ? s.status.toLowerCase()
          : posture.state === "verified"
            ? "Live"
            : posture.state === "pending"
              ? "Verifying"
              : "Unchecked",
      tone:
        s.status !== "ACTIVE" ? "mute" : posture.state === "verified" ? "live" : posture.state === "pending" ? "warn" : "mute",
      onOpen: () => setDrawer({ t: "sender", id: s.id }),
    };
  });

  const replyRow: SettingsRow[] = email.some((s) => s.replyTo)
    ? [
        {
          t: "val",
          key: "reply-to",
          n: "Reply-to",
          sub: "Goes to your shared inbox, not Ada",
          val: email.find((s) => s.replyTo)!.replyTo!,
        },
      ]
    : [];

  const numberRows: SettingsRow[] = [
    ...numbers.map<SettingsRow>((s) => ({
      t: "chip",
      key: s.id,
      ic: "\u2706",
      tint: "cyan",
      n: s.fromEmail ?? "This number",
      sub: `${s.sentToday ?? 0} sent today${s.dailyLimit != null ? ` of ${s.dailyLimit}` : ""}`,
      chip: s.status === "ACTIVE" ? "Live" : s.status.toLowerCase(),
      tone: s.status === "ACTIVE" ? "live" : "mute",
      onOpen: () => setDrawer({ t: "sender", id: s.id }),
    })),
    ...requests.map<SettingsRow>((r) => ({
      t: "chip",
      key: r.id,
      ic: "\u2706",
      tint: "cyan",
      n: `Area code ${r.areaCode}`,
      sub: `${r.carries === "sms" ? "SMS only" : "SMS and voice"} · ${r.a2pState === "not_filed" ? "A2P not filed yet" : `A2P ${r.a2pState.replace(/_/g, " ")}`}`,
      chip: "Requested",
      tone: "warn",
      onOpen: () => setDrawer({ t: "request", request: r }),
    })),
  ];

  const healthRows: SettingsRow[] = senders.map((s) => ({
    t: "chip",
    key: `h-${s.id}`,
    n: s.fromEmail ?? "This sender",
    sub: `${s.sentToday ?? 0} today${s.dailyLimit != null ? ` of ${s.dailyLimit}` : ""} · ${
      s.health?.score != null ? `health ${s.health.score} out of 100` : "no health sweep has run yet"
    }${s.warmup?.active && s.warmup.currentCap != null ? ` · today's ceiling ${s.warmup.currentCap}` : ""}`,
    chip: s.health?.state ?? "no data",
    tone: s.health?.state === "unhealthy" ? "warn" : s.health?.score != null ? "live" : "mute",
    onOpen: () => setDrawer({ t: "sender", id: s.id }),
  }));

  return (
    <>
      <BoldItemPage
        kind="WORKSPACE"
        title="Senders"
        status={
          email.length === 0
            ? { label: "None yet", tone: "mute" }
            : authed === email.length
              ? { label: "All verified", tone: "live" }
              : { label: "Needs a look", tone: "warn" }
        }
        stats={stats}
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        onBack={onBack}
        onHeader={onHeader}
        ada={ada}
        recordId={data.workspaceId}
        testid="bold-wss-senders-item"
      >
        {tab === 0 ? (
          <>
            {email.length === 0 ? (
              <EmptyTab
                testid="bold-senders-email-none"
                line="No email sender yet. Add one and every campaign picks it up — there are no pickers to keep in step."
              />
            ) : (
              <RowList rows={[...emailRows, ...replyRow]} testid="bold-senders-email" />
            )}
            <AddRow label="Add an email sender" testid="bold-senders-add-email" onClick={() => setDrawer({ t: "addEmail" })} />
            <TabNote>ONE IDENTITY PER WORKSPACE PER CHANNEL — CAMPAIGNS RESOLVE IT AUTOMATICALLY, NO PICKERS.</TabNote>
          </>
        ) : null}

        {tab === 1 ? (
          <>
            {numberRows.length === 0 ? (
              <EmptyTab
                testid="bold-senders-num-none"
                line="No number yet. Outbound calls dial from the platform line until this workspace has one of its own."
              />
            ) : (
              <RowList rows={numberRows} testid="bold-senders-num" />
            )}
            <AddRow label="Add a number" testid="bold-senders-add-number" onClick={() => setDrawer({ t: "addNumber" })} />
            <TabNote>
              RESERVING A NUMBER AND FILING A2P WITH THE CARRIERS IS NOT CONNECTED YET. A REQUEST RECORDS WHAT YOU ASKED
              FOR AND SHOWS ITS REAL STATE.
            </TabNote>
          </>
        ) : null}

        {tab === 2 ? (
          senders.length === 0 ? (
            <EmptyTab testid="bold-senders-health-none" line="Health arrives with your first sender." />
          ) : (
            <>
              <RowList rows={healthRows} testid="bold-senders-health" />
              <TabNote>
                HEALTH IS COMPUTED FROM THE SEND LEDGER OVER A ROLLING WINDOW. A SENDER WITH NO SWEEP YET SAYS SO RATHER
                THAN SCORING ITSELF.
              </TabNote>
            </>
          )
        ) : null}
      </BoldItemPage>

      {drawer?.t === "sender" ? (
        <SenderDrawer
          senderId={drawer.id}
          senders={senders}
          onClose={() => setDrawer(null)}
          onDone={done}
          flash={flash}
        />
      ) : null}
      {drawer?.t === "addEmail" ? <AddEmailSenderDrawer onDone={done} onClose={() => setDrawer(null)} /> : null}
      {drawer?.t === "addNumber" ? <AddNumberDrawer onDone={done} onClose={() => setDrawer(null)} /> : null}
      {drawer?.t === "request" ? (
        <NumberRequestDrawer request={drawer.request} onClose={() => setDrawer(null)} onDone={done} flash={flash} />
      ) : null}
    </>
  );
}
