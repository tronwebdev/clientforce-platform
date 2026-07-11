"use client";

/**
 * Step 5 — Guardrails & compliance (W3 commit 0: pure move from Wizard.tsx).
 * Readiness banner, senders (live P1.5), sending schedule + limits (A8),
 * compliance rows, the B9 connect drawer and the limits modal. All state
 * stays in the Wizard orchestrator.
 */
import { ConnectFlowDrawer } from "../../../(shell)/settings/shared";
import { GRAD, GradToggle, LimitCard, Modal, ModalActions, TZ_OPTIONS, cf, shiftH, tzShort, type SenderRow } from "../shared";

interface Step5Props {
  senders: SenderRow[];
  setSenders: React.Dispatch<React.SetStateAction<SenderRow[]>>;
  dailyCap: number;
  setDailyCap: React.Dispatch<React.SetStateAction<number>>;
  smsDailyCap: number;
  setSmsDailyCap: React.Dispatch<React.SetStateAction<number>>;
  windowStart: string;
  setWindowStart: React.Dispatch<React.SetStateAction<string>>;
  windowEnd: string;
  setWindowEnd: React.Dispatch<React.SetStateAction<string>>;
  timezone: string;
  setTimezone: React.Dispatch<React.SetStateAction<string>>;
  tzOpen: boolean;
  setTzOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sendDays: boolean[];
  setSendDays: React.Dispatch<React.SetStateAction<boolean[]>>;
  quietHours: boolean;
  setQuietHours: React.Dispatch<React.SetStateAction<boolean>>;
  ramp: boolean;
  setRamp: React.Dispatch<React.SetStateAction<boolean>>;
  limitsOpen: boolean;
  setLimitsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  connectOpen: boolean;
  setConnectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  saveLimits: () => Promise<void>;
  toast: (m: string) => void;
}

export function Step5Guardrails(props: Step5Props) {
  const {
    senders, setSenders, dailyCap, setDailyCap, smsDailyCap, setSmsDailyCap,
    windowStart, setWindowStart, windowEnd, setWindowEnd, timezone, setTimezone,
    tzOpen, setTzOpen, sendDays, setSendDays, quietHours, setQuietHours, ramp, setRamp,
    limitsOpen, setLimitsOpen, connectOpen, setConnectOpen, saveLimits, toast,
  } = props;
  return (
    <>
          <div style={{ maxWidth: 820 }}>
            {/* channel readiness (email-only phase: reqChannels = [Email]) */}
            {senders.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 14, padding: "15px 18px", marginBottom: 12 }} data-testid="ready-banner">
                <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: GRAD, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✓</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Email channel ready to send</div>
                  <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Every step in your sequence has a connected, healthy sender.</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(232,196,91,.12)", border: "1px solid rgba(232,196,91,.5)", borderRadius: 14, padding: "15px 18px", marginBottom: 12 }} data-testid="ready-banner">
                <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "rgba(232,196,91,.25)", color: "#A87B16", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚠</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Email channel not ready</div>
                  <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Connect Email below before this agent can launch.</div>
                </div>
              </div>
            )}

            <div style={{ margin: "4px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Channels &amp; senders</div>

            {/* email senders (live P1.5 SenderConnections) */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18, overflow: "hidden" }} data-testid="senders-list">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px" }}>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512", flex: 1 }}>Email senders <span style={{ fontSize: 13, fontWeight: 600, color: "#9AA59E" }}>· {senders.length} connected</span></span>
                <span onClick={() => setConnectOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "8px 14px", cursor: "pointer" }} data-testid="wizard-add-sender">＋ Add sender</span>
              </div>
              {senders.length === 0 ? (
                <div style={{ borderTop: "1px solid #F2EEE4", padding: "20px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, flex: "none", background: "#F2EEE4", color: "#9AA59E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✉</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>No email sender connected</div>
                    <div style={{ fontSize: 12, color: "#8A7F6B" }}>Required for Email steps.</div>
                  </div>
                </div>
              ) : (
                senders.map((s) => {
                  const auth = (s.domainAuthStatus ?? {}) as Record<string, { pass?: boolean } | boolean | undefined>;
                  const passes = ["spf", "dkim", "dmarc"].filter((k) => {
                    const v = auth[k];
                    return v === true || (typeof v === "object" && v?.pass === true);
                  }).length;
                  const healthy = passes === 3;
                  const pct = Math.min(100, Math.round((s.sentToday / Math.max(1, s.dailyLimit)) * 100));
                  const active = s.status === "ACTIVE";
                  return (
                    <div key={s.id} style={{ borderTop: "1px solid #F2EEE4", padding: "15px 18px" }} data-testid="sender-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 13 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "rgba(208,245,107,.4)", color: "#6B7A1F", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 16 }}>f</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{s.fromEmail}</div>
                          <div style={{ fontSize: 12, color: "#9AA59E" }}>Clientforce Mailer · {s.fromName ?? "—"}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#0F7A28" : "#A87B16", background: active ? "#D7F5DD" : "rgba(232,196,91,.18)", borderRadius: 7, padding: "5px 10px", flex: "none" }}>{active ? "Active" : s.status}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ flex: "none", textAlign: "left", minWidth: 74 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E", marginBottom: 2 }}>Auth</div>
                          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 19, lineHeight: 1, color: healthy ? "#16A82A" : "#E8C45B" }}>{passes}/3<span style={{ fontSize: 11, fontWeight: 600, color: "#8A7F6B" }}> {healthy ? "Pass" : "Needs DNS"}</span></div>
                        </div>
                        <div style={{ flex: "none", minWidth: 90 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E", marginBottom: 4 }}>Reputation</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 9, height: 9, borderRadius: "50%", background: active ? "#16A82A" : "#E8C45B" }} />
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{active ? "Good" : "Building"}</span>
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E" }}>Daily sending</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5C6B62" }}>{s.sentToday.toLocaleString()} / {s.dailyLimit.toLocaleString()}</span>
                          </div>
                          <div style={{ height: 7, borderRadius: 100, background: "#F2EEE4", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 100, background: healthy ? "#16A82A" : "#E8C45B" }} />
                          </div>
                        </div>
                        <span onClick={() => setLimitsOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: "pointer", flex: "none" }} data-testid="sender-manage">Manage</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ margin: "26px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Sending behavior</div>

            {/* sending schedule → Guardrails.sendingWindow */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "18px 20px", marginBottom: 18 }} data-testid="schedule-card">
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Sending schedule</div>
              <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2, marginBottom: 16 }}>The agent only sends inside this window — replies are still handled 24/7.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1.4, position: "relative" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Timezone</label>
                  {/* B10: the prototype's control is a picker (cursor:pointer + ▾) — make it one. */}
                  <div onClick={() => setTzOpen(!tzOpen)} style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="tz-box">
                    {timezone === "UTC" ? "UTC" : `${timezone} (${tzShort(timezone)})`}
                    <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
                  </div>
                  {tzOpen ? (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 12px 32px rgba(14,21,18,.12)", zIndex: 30, maxHeight: 264, overflowY: "auto" }} data-testid="tz-menu">
                      {TZ_OPTIONS.map((t) => (
                        <div key={t.zone} onClick={() => { setTimezone(t.zone); setTzOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 15px", fontSize: 13.5, color: "#0E1512", cursor: "pointer", background: timezone === t.zone ? "rgba(53,232,52,.07)" : "#fff" }} data-testid={`tz-opt-${t.zone.replace("/", "-")}`}>
                          <span style={{ color: "#9AA59E", fontSize: 12.5, flex: "none" }}>({t.offset})</span>
                          {t.label}
                          {timezone === t.zone ? <span style={{ marginLeft: "auto", color: "#16A82A", fontWeight: 700 }}>✓</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Sending window</label>
                  <div onClick={() => setLimitsOpen(true)} style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="window-box">{windowStart} – {windowEnd}<span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span></div>
                </div>
              </div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 8 }}>Sending days</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => {
                  const on = sendDays[i];
                  return (
                    <span key={label} onClick={() => setSendDays((d) => d.map((v, j) => (j === i ? !v : v)))} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, padding: "9px 0", borderRadius: 10, background: on ? "#0E1512" : "#fff", color: on ? "#fff" : "#9AA59E", border: `1px solid ${on ? "#0E1512" : "#EBE3D6"}`, cursor: "pointer" }} data-testid={`day-${label}`}>{label}</span>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 15px" }}>
                <span style={{ fontSize: 18, flex: "none" }}>🌙</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>Pause outside business hours</div>
                  <div style={{ fontSize: 12, color: "#8A7F6B" }}>Hold queued messages overnight &amp; on weekends instead of sending late.</div>
                </div>
                <GradToggle on={quietHours} onClick={() => setQuietHours((v) => !v)} tid="toggle-quiet" />
              </div>
            </div>

            {/* volume & deliverability limits → Guardrails.dailyCap */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "18px 20px" }} data-testid="limits-card">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Volume &amp; deliverability limits</div>
                  <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>Daily caps protect your sender reputation across channels.</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
                <div onClick={() => setLimitsOpen(true)} style={{ display: "flex", alignItems: "center", gap: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }} data-testid="limit-email">
                  <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(53,232,52,.16)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✉</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B", fontWeight: 600 }}>Email</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{dailyCap} / day</div>
                  </div>
                </div>
                {/* P2.1 (DEC-061): the sms cap tile — same anatomy, channel tint */}
                <div onClick={() => setLimitsOpen(true)} style={{ display: "flex", alignItems: "center", gap: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }} data-testid="limit-sms">
                  <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.16)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>💬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B", fontWeight: 600 }}>SMS</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{smsDailyCap} / day</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 15px" }}>
                <span style={{ fontSize: 18, flex: "none" }}>📈</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>Gradually ramp send volume</div>
                  <div style={{ fontSize: 12, color: "#8A7F6B" }}>Warm-up-safe — increases daily volume slowly to protect new senders.</div>
                </div>
                <GradToggle on={ramp} onClick={() => setRamp((v) => !v)} tid="toggle-ramp" />
              </div>
            </div>

            <div style={{ margin: "26px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Compliance &amp; consent</div>

            {/* AI compliance banner */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,rgba(53,232,52,.12),rgba(54,215,237,.08))", border: "1px solid rgba(53,232,52,.28)", borderRadius: 14, padding: "15px 18px", marginBottom: 18 }} data-testid="compliance-banner">
              <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#0A0F0C" }}>✓</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Compliance check passed</div>
                <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Your sequence meets outreach regulations for the regions you&apos;re targeting.</div>
              </div>
              <div style={{ display: "flex", gap: 7, flex: "none" }}>
                {["CAN-SPAM ✓", "GDPR ✓", "CASL ✓"].map((c) => (
                  <span key={c} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.14)", borderRadius: 8, padding: "5px 10px" }}>{c}</span>
                ))}
              </div>
            </div>

            {/* consent & opt-out — A8: unsubscribeFooter + suppressionCheck are
                literal true, never disableable → locked rows, no toggles. */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18, overflow: "hidden" }} data-testid="consent-card">
              <div style={{ padding: "16px 20px 4px" }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Consent &amp; opt-out</div>
                <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>How contacts opt out, and who the agent must never message.</div>
              </div>
              {[
                { icon: "✉", label: "One-click unsubscribe footer", desc: "Appended to every email — CAN-SPAM & GDPR compliant." },
                { icon: "🚫", label: "Honor suppression list", desc: "Never contact addresses on your workspace suppression list." },
                { icon: "⛔", label: "Respect opt-outs", desc: "Skip contacts who opted out and auto-suppress anyone who unsubscribes." },
              ].map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderTop: "1px solid #F2EEE4" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "rgba(53,232,52,.12)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{c.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{c.label}</div>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>{c.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 7, padding: "5px 10px", flex: "none" }}>🔒 Required</span>
                </div>
              ))}
            </div>
          </div>

      {/* B9: add-sender connect flow — the same drawer Settings → Channels uses
          (prototype `openAddEmail`); the senders list + readiness banner refetch
          on close so a sender added mid-wizard counts immediately. */}
      {connectOpen ? (
        <ConnectFlowDrawer
          channel="email"
          onClose={() => {
            setConnectOpen(false);
            void cf("senders").then(setSenders).catch(() => {});
          }}
          toast={toast}
          onMailerCreated={() => void cf("senders").then(setSenders).catch(() => {})}
        />
      ) : null}

      {/* volume & limits modal — stepper controls writing the Guardrails schema */}
      {limitsOpen ? (
        <Modal onClose={() => setLimitsOpen(false)} title="Volume & limits" tid="limits-modal">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <LimitCard label="Daily email cap" value={String(dailyCap)} onMinus={() => setDailyCap((v) => Math.max(10, v - 10))} onPlus={() => setDailyCap((v) => v + 10)} tid="cap" />
            {/* P2.1 (DEC-061): per-channel sms cap (guardrails dailyCap.sms) */}
            <LimitCard label="Daily SMS cap" value={String(smsDailyCap)} onMinus={() => setSmsDailyCap((v) => Math.max(10, v - 10))} onPlus={() => setSmsDailyCap((v) => v + 10)} tid="sms-cap" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <LimitCard label="Window start (UTC)" value={windowStart} onMinus={() => setWindowStart(shiftH(windowStart, -1))} onPlus={() => setWindowStart(shiftH(windowStart, 1))} tid="start" />
            <LimitCard label="Window end (UTC)" value={windowEnd} onMinus={() => setWindowEnd(shiftH(windowEnd, -1))} onPlus={() => setWindowEnd(shiftH(windowEnd, 1))} tid="end" />
          </div>
          <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 14 }}>Unsubscribe footer and suppression checks are always on — they can&apos;t be disabled.</div>
          <ModalActions onCancel={() => setLimitsOpen(false)} onSave={() => void saveLimits()} />
        </Modal>
      ) : null}
    </>
  );
}
