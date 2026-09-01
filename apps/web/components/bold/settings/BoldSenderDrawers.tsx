"use client";

/**
 * Senders' drawers (SURFACE_SPEC_SETTINGS §6): the per-sender detail, the
 * three-step add-email flow with its live DNS step, and add-a-number.
 *
 * The DNS step is the interesting one. It is not a picture of records — the
 * shipped checker persists, per record, the exact line the owner must publish
 * and whether a real lookup found it. So this renders those lines verbatim and
 * re-runs the check on a timer until they pass, which is what "I check every
 * few minutes until they pass" has to mean if it is going to be said out loud.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WARMUP_PACES } from "@clientforce/core";
import { mono } from "../bold-cards";
import {
  ChoiceRow,
  DrawerError,
  EYEBROW,
  PrimaryButton,
  SettingsDrawer,
  StepDots,
  StepPrompt,
  Well,
  CHIP,
} from "../bold-settings-kit";
import { createEmailSender, runDnsCheck, type BoldSenderRow } from "../bold-live";
import {
  cancelNumberRequest,
  fetchSenderHealth,
  patchSender,
  requestNumber,
  type DnsRecordRead,
  type NumberRequestRow,
  type SenderHealthRead,
} from "../bold-settings-live";

/* --------------------------------------------------------- the DNS block */

const RECORD_ORDER = ["spf", "dkim", "dmarc"] as const;

/** The dark mono block: one line per record, with its real posture. */
export function DnsBlock({ status }: { status: Record<string, DnsRecordRead> | null | undefined }) {
  const entries = RECORD_ORDER.filter((k) => status?.[k]).map((k) => [k, status![k]!] as const);
  if (entries.length === 0) {
    return (
      <div
        data-testid="bold-dns-block-empty"
        style={{
          background: "linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)",
          borderRadius: 16,
          padding: "18px 20px",
          color: "rgba(255,255,255,.72)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        No check has run yet, so there is nothing to show. The records appear the moment the first
        check comes back.
      </div>
    );
  }
  return (
    <div
      data-testid="bold-dns-block"
      style={{
        background: "linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)",
        borderRadius: 16,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 15,
      }}
    >
      {entries.map(([key, rec]) => (
        <div key={key} data-testid={`bold-dns-${key}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                ...mono,
                fontSize: 9.5,
                letterSpacing: ".18em",
                color: "rgba(255,255,255,.5)",
              }}
            >
              {key.toUpperCase()}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                ...mono,
                fontSize: 9,
                letterSpacing: ".14em",
                borderRadius: 999,
                padding: "3px 9px",
                color:
                  rec.status === "verified"
                    ? "#B9F5B8"
                    : rec.status === "failed"
                      ? "#F5C9C0"
                      : "rgba(255,255,255,.6)",
                background:
                  rec.status === "verified"
                    ? "rgba(53,232,52,.13)"
                    : rec.status === "failed"
                      ? "rgba(176,72,58,.22)"
                      : "rgba(255,255,255,.08)",
                border: `1px solid ${rec.status === "verified" ? "rgba(53,232,52,.32)" : "rgba(255,255,255,.16)"}`,
              }}
            >
              {rec.status === "verified"
                ? "PASSING"
                : rec.status === "failed"
                  ? "NOT FOUND"
                  : "UNCHECKED"}
            </span>
          </div>
          <div
            style={{
              ...mono,
              fontSize: 10.5,
              color: "rgba(255,255,255,.88)",
              lineHeight: 1.7,
              marginTop: 7,
              wordBreak: "break-all",
            }}
          >
            {rec.expected ?? rec.found ?? rec.detail}
          </div>
          <div
            style={{ fontSize: 11, color: "rgba(255,255,255,.45)", lineHeight: 1.5, marginTop: 5 }}
          >
            {rec.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- the sender drawer */

/**
 * One sender's detail. It is opened from the Email tab, the Numbers tab AND
 * the Health tab, so it takes the sender ID and resolves everything else
 * itself — health, warm-up and DNS come from the health read, not from
 * whichever row happened to open it. A drawer that trusts its caller's row to
 * carry fields is how three fields at once come back undefined.
 */
export function SenderDrawer({
  senderId,
  senders,
  onClose,
  onDone,
  flash,
}: {
  senderId: string;
  senders: BoldSenderRow[];
  onClose: () => void;
  onDone: (toast: string) => Promise<void>;
  flash: (m: string) => void;
}) {
  const row = senders.find((s) => s.id === senderId) ?? null;
  const [health, setHealth] = useState<SenderHealthRead | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [capDraft, setCapDraft] = useState("");
  const [editingCap, setEditingCap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchSenderHealth(senderId).then((h) => {
      if (!alive) return;
      setHealth(h);
      setLoaded(true);
      if (h?.warmup?.target != null) setCapDraft(String(h.warmup.target));
    });
    return () => {
      alive = false;
    };
  }, [senderId]);

  if (row === null) {
    return (
      <SettingsDrawer
        label="SENDER"
        title="That sender is gone"
        onClose={onClose}
        testid="bold-drawer-sender"
      >
        <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
          It was removed while this was open. Close and the list will be current.
        </div>
      </SettingsDrawer>
    );
  }

  const isNumber = row.type === "TWILIO_SMS";
  const sample = health?.sample;
  const warm = health?.warmup ?? row.warmup ?? null;
  const dns = (health?.domainAuthStatus ?? row.domainAuthStatus) as
    Record<string, DnsRecordRead> | null | undefined;

  const stats: Array<[string, string, string]> = isNumber
    ? [
        ["SENT", String(row.sentToday ?? 0), "today"],
        [
          "ALL TIME",
          health?.sentAllTime != null ? String(health.sentAllTime) : "—",
          "messages out",
        ],
        ["DAILY CEILING", row.dailyLimit != null ? String(row.dailyLimit) : "—", "per day"],
      ]
    : [
        ["SENT", sample ? String(sample.sent) : "—", `last ${health?.windowDays ?? 7} days`],
        ["BOUNCES", sample ? String(sample.bounced) : "—", "hard failures"],
        ["COMPLAINTS", sample ? String(sample.spam) : "—", "marked as spam"],
      ];

  async function saveCap() {
    const n = Number(capDraft.trim());
    if (!Number.isInteger(n) || n < 1) {
      setError("A daily ceiling is a whole number of sends.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await patchSender(senderId, { dailyLimit: n });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditingCap(false);
    await onDone(`Daily ceiling is ${n}.`);
  }

  return (
    <SettingsDrawer
      label={isNumber ? "NUMBER" : "EMAIL SENDER"}
      title={row.fromEmail ?? "This sender"}
      onClose={onClose}
      testid="bold-drawer-sender"
    >
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {stats.map(([label, v, sub]) => (
          <div key={label} style={{ minWidth: 92 }}>
            <div
              style={{ ...mono, fontSize: 9, letterSpacing: ".13em", color: "var(--cvb-faint)" }}
            >
              {label}
            </div>
            {/* 800/14px on the UI face, NOT the display family — Console Bold.dc.html:1944. */}
            <div
              style={{
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: "-.02em",
                marginTop: 6,
              }}
            >
              {v}
            </div>
            <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 3 }}>{sub}</div>
          </div>
        ))}
      </div>

      {warm?.active ? (
        <div
          data-testid="bold-drawer-sender-warmup"
          style={{
            background: "var(--cvb-amber-bg)",
            border: "1px solid var(--cvb-amber-line)",
            borderRadius: 16,
            padding: "15px 17px",
            marginTop: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            {/* 800/12.5px on the UI face — Console Bold.dc.html:1953. */}
            <span
              style={{
                fontWeight: 800,
                fontSize: 12.5,
                color: "var(--cvb-amber)",
              }}
            >
              {warm.pct}%
            </span>
            <span style={{ fontSize: 12.5, color: "var(--cvb-amber)", flex: 1 }}>warmed up</span>
          </div>
          <div
            style={{
              height: 5,
              borderRadius: 3,
              background: "rgba(138,109,26,.16)",
              overflow: "hidden",
              marginTop: 10,
            }}
          >
            <span
              style={{
                display: "block",
                height: 5,
                width: `${Math.max(0, Math.min(100, warm.pct))}%`,
                background: "var(--cvb-amber)",
                borderRadius: 3,
              }}
            />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cvb-amber)", lineHeight: 1.5, marginTop: 9 }}>
            {warm.currentCap != null
              ? `Capped at ${warm.currentCap} a day until it reaches 100%.`
              : "Ramping — the ceiling rises each day."}
          </div>
        </div>
      ) : null}

      <div style={{ ...EYEBROW, margin: "24px 0 12px" }}>
        {isNumber ? "REGISTRATION" : "AUTHENTICATION"}
      </div>
      {isNumber ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <RegRow
            label="A2P brand"
            value="Not filed — number filing is not connected yet"
            tone="mute"
          />
          <RegRow label="A2P campaign" value="Not filed" tone="mute" />
          <RegRow label="Caller ID" value={row.fromName ?? "Not set"} tone="mute" />
        </div>
      ) : loaded ? (
        <DnsBlock status={dns} />
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>
          Reading the current posture…
        </div>
      )}

      <div style={{ ...EYEBROW, margin: "24px 0 12px" }}>WHAT YOU CAN DO</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!isNumber ? (
          <ActionRow
            label="Re-check the records"
            sub="Runs a real lookup now and replaces what is shown above."
            testid="bold-drawer-sender-recheck"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const res = await runDnsCheck(senderId);
                setBusy(false);
                if (!res.ok) {
                  flash(res.error);
                  return;
                }
                const h = await fetchSenderHealth(senderId);
                setHealth(h);
                flash("Checked — the posture above is current.");
              })();
            }}
          />
        ) : null}
        {editingCap ? (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Well
                label="SENDS A DAY"
                value={capDraft}
                onChange={setCapDraft}
                testid="bold-drawer-sender-cap"
                onEnter={() => void saveCap()}
              />
            </div>
            <PrimaryButton
              label="Save"
              busy={busy}
              testid="bold-drawer-sender-cap-save"
              onClick={() => void saveCap()}
            />
          </div>
        ) : (
          <ActionRow
            label="Change the daily ceiling"
            sub={
              row.dailyLimit != null ? `${row.dailyLimit} a day right now.` : "No ceiling recorded."
            }
            testid="bold-drawer-sender-cap-edit"
            onClick={() => setEditingCap(true)}
          />
        )}
      </div>

      <div style={{ marginTop: 24, borderTop: "1px solid var(--cvb-line-inner)", paddingTop: 18 }}>
        {confirm ? (
          <>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--cvb-danger)",
                lineHeight: 1.55,
                marginBottom: 12,
              }}
            >
              Pausing stops every send from this {isNumber ? "number" : "address"} immediately.
              Anything already queued waits rather than going out from somewhere else.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <PrimaryButton
                label="Pause it"
                tone="danger"
                busy={busy}
                testid="bold-drawer-sender-pause-confirm"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const res = await patchSender(senderId, { status: "PAUSED" });
                    setBusy(false);
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    await onDone("Paused — nothing sends from it now.");
                  })();
                }}
              />
              <PrimaryButton
                label="Leave it running"
                tone="quiet"
                onClick={() => setConfirm(false)}
              />
            </div>
          </>
        ) : row.status === "PAUSED" ? (
          <PrimaryButton
            label="Start sending again"
            busy={busy}
            testid="bold-drawer-sender-resume"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const res = await patchSender(senderId, { status: "ACTIVE" });
                setBusy(false);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                await onDone("Sending again.");
              })();
            }}
          />
        ) : (
          <>
            <span
              onClick={() => setConfirm(true)}
              role="button"
              data-testid="bold-drawer-sender-pause"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--cvb-danger)",
                cursor: "pointer",
              }}
            >
              Pause this {isNumber ? "number" : "sender"}
            </span>
            <div
              style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 7 }}
            >
              Releasing it for good is not something this workspace can do yet — pausing is the
              reversible half, and it is the one that stops sends.
            </div>
          </>
        )}
        <DrawerError message={error} />
      </div>
    </SettingsDrawer>
  );
}

function RegRow({ label, value, tone }: { label: string; value: string; tone: "live" | "mute" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{label}</span>
      <span style={tone === "live" ? CHIP.live : CHIP.mute}>{value}</span>
    </div>
  );
}

function ActionRow({
  label,
  sub,
  onClick,
  testid,
}: {
  label: string;
  sub: string;
  onClick: () => void;
  testid?: string;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      data-testid={testid}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--cvb-panel-quiet)",
        border: "1px solid var(--cvb-line)",
        borderRadius: 14,
        padding: "13px 15px",
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.45 }}>
          {sub}
        </div>
      </div>
      <span style={{ color: "var(--cvb-cyan)", fontSize: 13 }}>›</span>
    </div>
  );
}

/* -------------------------------------------------- add an email sender */

/**
 * Three steps: the address, the live DNS step, the warm-up pace.
 *
 * The DNS step polls the real checker while it is open. It never claims a pass
 * it did not observe — an unchecked record reads unchecked, and "Finish" stays
 * available either way, because holding the owner hostage to their registrar
 * would be worse than letting them come back to it.
 */
export function AddEmailSenderDrawer({
  onDone,
  onClose,
}: {
  onDone: (toast: string) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [pace, setPace] = useState<"careful" | "standard" | "fast">("standard");
  const [senderId, setSenderId] = useState<string | null>(null);
  const [dns, setDns] = useState<Record<string, DnsRecordRead> | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async (id: string) => {
    setChecking(true);
    await runDnsCheck(id);
    const h = await fetchSenderHealth(id);
    setDns((h?.domainAuthStatus ?? null) as Record<string, DnsRecordRead> | null);
    setChecking(false);
  }, []);

  // "I check every few minutes until they pass" — so it actually does.
  useEffect(() => {
    if (step !== 1 || senderId === null) return;
    void check(senderId);
    timer.current = setInterval(() => void check(senderId), 45_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [step, senderId, check]);

  const records = dns ? RECORD_ORDER.filter((k) => dns[k]) : [];
  const passing = records.filter((k) => dns?.[k]?.status === "verified");
  const waitingLine =
    records.length === 0
      ? "Waiting for the first check to come back"
      : passing.length === records.length
        ? "All records are passing"
        : `Waiting for ${records.length - passing.length} of ${records.length} records`;

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createEmailSender({
      fromEmail: fromEmail.trim(),
      ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
      ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const id = (res.body as { id?: string })?.id ?? null;
    setSenderId(id);
    setStep(1);
  }

  return (
    <SettingsDrawer
      label="NEW EMAIL SENDER"
      title="Add an email sender"
      onClose={onClose}
      testid="bold-drawer-addsender"
      footer={
        <>
          {step === 2 ? (
            <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(1)} />
          ) : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={3} />
          {step === 0 ? (
            <PrimaryButton
              label="Next"
              busy={busy}
              testid="bold-drawer-addsender-create"
              onClick={() => void create()}
            />
          ) : step === 1 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-addsender-next"
              onClick={() => setStep(2)}
            />
          ) : (
            <PrimaryButton
              label="Finish"
              testid="bold-drawer-addsender-finish"
              onClick={() => void onDone("Sender added — checking DNS.")}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt
            prompt="Which address should she send from?"
            help="Use a real mailbox you can read — replies go there."
          />
          <Well
            label="THE ADDRESS"
            value={fromEmail}
            onChange={setFromEmail}
            placeholder="hello@brightsmile.com"
            testid="bold-drawer-addsender-email"
            autoFocus
          />
          <div style={{ marginTop: 14 }}>
            <Well
              label="THE NAME PEOPLE SEE"
              value={fromName}
              onChange={setFromName}
              placeholder="Bright Smile Dental"
              testid="bold-drawer-addsender-name"
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <Well
              label="REPLIES GO TO (OPTIONAL)"
              value={replyTo}
              onChange={setReplyTo}
              placeholder="front-desk@brightsmile.com"
              testid="bold-drawer-addsender-replyto"
            />
          </div>
          <DrawerError message={error} />
        </>
      ) : step === 1 ? (
        <>
          <StepPrompt
            prompt="Publish these two records with whoever runs your domain."
            help="I check every few minutes until they pass. Until they do, sends from this address stay held."
          />
          <DnsBlock status={dns} />
          <div
            data-testid="bold-drawer-addsender-dnsstatus"
            style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flex: "none",
                background:
                  passing.length === records.length && records.length > 0
                    ? "var(--cvb-live)"
                    : "var(--cvb-warn-dot)",
              }}
            />
            <span
              style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--cvb-muted)" }}
            >
              {checking ? "CHECKING…" : waitingLine.toUpperCase()}
            </span>
          </div>
        </>
      ) : (
        <>
          <StepPrompt
            prompt="How fast should she ramp up?"
            help="A brand-new address that sends at full volume gets filtered. The ramp is what stops that."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {WARMUP_PACES.map((p) => (
              <ChoiceRow
                key={p.key}
                title={p.title}
                sub={p.detail}
                meta={p.recommended ? "recommended" : undefined}
                selected={pace === p.key}
                onSelect={() => setPace(p.key)}
                testid={`bold-drawer-addsender-pace-${p.key}`}
              />
            ))}
          </div>
          <div
            style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 14 }}
          >
            Every new sender ramps on the same curve today — the pace you pick is recorded with the
            sender and takes effect when per-sender ramps land.
          </div>
        </>
      )}
    </SettingsDrawer>
  );
}

/* ------------------------------------------------------------ add a number */

/**
 * Three steps: the area code, what it carries, and the filing step.
 *
 * The filing step tells the truth. Reserving a number and filing A2P is not
 * connected on this platform, so this records the ask and shows its real state
 * rather than showing an approved badge for a filing nobody made.
 */
export function AddNumberDrawer({
  onDone,
  onClose,
}: {
  onDone: (toast: string) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [areaCode, setAreaCode] = useState("");
  const [carries, setCarries] = useState<"sms" | "sms_voice">("sms_voice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await requestNumber({ areaCode: areaCode.trim(), carries });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onDone("Number requested — it shows on the Numbers tab with its state.");
  }

  return (
    <SettingsDrawer
      label="NEW NUMBER"
      title="Add a number"
      onClose={onClose}
      testid="bold-drawer-addnumber"
      footer={
        <>
          {step > 0 ? (
            <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(step - 1)} />
          ) : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={3} />
          {step < 2 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-addnumber-next"
              onClick={() =>
                step === 0 ? /^\d{3}$/.test(areaCode.trim()) && setStep(1) : setStep(2)
              }
            />
          ) : (
            <PrimaryButton
              label="Request the number"
              busy={busy}
              testid="bold-drawer-addnumber-finish"
              onClick={() => void finish()}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt prompt="Which area code?" help="Local numbers get answered more often." />
          <Well
            label="AREA CODE"
            value={areaCode}
            onChange={(v) => setAreaCode(v.replace(/\D/g, "").slice(0, 3))}
            placeholder="512"
            testid="bold-drawer-addnumber-area"
            autoFocus
            onEnter={() => /^\d{3}$/.test(areaCode.trim()) && setStep(1)}
          />
        </>
      ) : step === 1 ? (
        <>
          <StepPrompt prompt="What should it carry?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <ChoiceRow
              title="SMS only"
              sub="Texts out and replies in. Calls to it go nowhere."
              selected={carries === "sms"}
              onSelect={() => setCarries("sms")}
              testid="bold-drawer-addnumber-sms"
            />
            <ChoiceRow
              title="SMS and voice"
              sub="Texts, plus a line she can call from and answer on."
              selected={carries === "sms_voice"}
              onSelect={() => setCarries("sms_voice")}
              testid="bold-drawer-addnumber-both"
            />
          </div>
        </>
      ) : (
        <>
          <StepPrompt
            prompt="A2P filing takes about a day."
            help="Carriers require every business texting number to be registered before it can send."
          />
          <div
            data-testid="bold-drawer-addnumber-a2p"
            style={{
              background: "var(--cvb-amber-bg)",
              border: "1px solid var(--cvb-amber-line)",
              borderRadius: 16,
              padding: "15px 17px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cvb-amber)" }}>
              Filing is not connected yet
            </div>
            <div style={{ fontSize: 12, color: "var(--cvb-amber)", lineHeight: 1.6, marginTop: 7 }}>
              Reserving the number and filing your brand with the carriers is not something this
              workspace can do on its own yet. Requesting it here records exactly what you asked for
              — area code {areaCode || "—"}, {carries === "sms" ? "SMS only" : "SMS and voice"} —
              and the Numbers tab shows its real state until the filing lands.
            </div>
          </div>
          <DrawerError message={error} />
        </>
      )}
    </SettingsDrawer>
  );
}

/* ------------------------------------------------- a requested number's row */

export function NumberRequestDrawer({
  request,
  onClose,
  onDone,
  flash,
}: {
  request: NumberRequestRow;
  onClose: () => void;
  onDone: (toast: string) => Promise<void>;
  flash: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <SettingsDrawer
      label="REQUESTED NUMBER"
      title={`Area code ${request.areaCode}`}
      onClose={onClose}
      testid="bold-drawer-numberrequest"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <PrimaryButton
            label="Withdraw the request"
            tone="danger"
            busy={busy}
            testid="bold-drawer-numberrequest-cancel"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const res = await cancelNumberRequest(request.id);
                setBusy(false);
                if (!res.ok) {
                  flash(res.error);
                  return;
                }
                await onDone("Request withdrawn.");
              })();
            }}
          />
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <RegRow
          label="Carries"
          value={request.carries === "sms" ? "SMS only" : "SMS and voice"}
          tone="mute"
        />
        <RegRow label="State" value={request.status.toLowerCase()} tone="mute" />
        <RegRow
          label="A2P"
          value={
            request.a2pState === "not_filed" ? "Not filed yet" : request.a2pState.replace(/_/g, " ")
          }
          tone={request.a2pState === "approved" ? "live" : "mute"}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 18 }}>
        Nothing has been reserved with a carrier — number provisioning and A2P filing arrive
        together, and this request is what they will pick up when they do.
      </div>
    </SettingsDrawer>
  );
}
