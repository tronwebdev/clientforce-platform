"use client";

/**
 * Workspace Settings (C2.6, checkpoints §6) — ported from `Settings.dc.html`.
 * Page frame: own header + 226px sticky sub-nav rail + content column.
 * Channels (email/mailer), Suppression and parts of Brand kit are WIRED;
 * every other section renders its designed layout inert (no dead ends).
 * Section deep-links honor `window.location.hash` per the prototype.
 */
import { useEffect, useState } from "react";
import { BrandKit } from "./BrandKit";
import { EmailSendersSection, MailerSendersSection, SmsSendersSection, SuppressionSection } from "./ChannelsSections";
import {
  BillingSection,
  CustomFieldsSection,
  ProfileSection,
  SchedulesSection,
  TeamSection,
  UsageSection,
  WhatsappSection,
} from "./InertSections";
import { BRICO, Toast } from "./shared";

/** Prototype line 922 — `notifications`/`api`/`security` are valid hashes with no render block. */
const VALID_SECTIONS = ["profile", "billing", "custom", "team", "brand", "schedules", "usage", "email", "mailer", "phone", "whatsapp", "suppress", "notifications", "api", "security"];

interface NavItem {
  id: string;
  icon: string;
  label: string;
  beta?: boolean;
  iconColor?: string;
}
const ACCOUNT_NAV: NavItem[] = [
  { id: "profile", icon: "☺", label: "Your profile" },
  { id: "billing", icon: "＄", label: "Plans & billing" },
  { id: "custom", icon: "✎", label: "Custom fields" },
];
const WORKSPACE_NAV: NavItem[] = [
  { id: "team", icon: "👥", label: "Team" },
  { id: "brand", icon: "📚", label: "Brand knowledge" },
  { id: "schedules", icon: "🕘", label: "Schedules" },
  { id: "usage", icon: "▥", label: "Workspace usage" },
];
const COMM_NAV: NavItem[] = [
  { id: "email", icon: "✉", label: "Email senders" },
  { id: "mailer", icon: "📨", label: "Clientforce Mailer", beta: true },
  { id: "phone", icon: "☎", label: "Phone & SMS" },
  { id: "whatsapp", icon: "🗨", label: "WhatsApp senders" },
  { id: "suppress", icon: "⊘", label: "Suppression list", iconColor: "#C9543F" },
];

const ACTIVE_PILL = "linear-gradient(96deg,rgba(53,232,52,.20) 0%,rgba(54,215,237,.10) 60%,rgba(54,215,237,0) 100%)";

const groupHead = (topBorder: boolean): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#9AA59E", padding: "14px 18px 8px", ...(topBorder ? { borderTop: "1px solid #F2EEE4" } : {}) });

export function SettingsView() {
  const [section, setSection] = useState("profile");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const h = (window.location.hash || "").replace("#", "");
    if (h && VALID_SECTIONS.includes(h)) setSection(h);
  }, []);

  const navItem = (s: NavItem) => {
    const on = s.id === section;
    return (
      <div
        key={s.id}
        onClick={() => {
          setSection(s.id);
          setToast("");
        }}
        style={{ display: "flex", alignItems: "center", gap: 11, margin: "3px 10px", padding: "7px 10px", borderRadius: 11, fontSize: 14, fontWeight: on ? 700 : 600, color: on ? "#0E1512" : "#3B463F", background: on ? ACTIVE_PILL : "transparent", boxShadow: on ? "0 1px 2px rgba(14,21,18,.06)" : "none", cursor: "pointer" }}
        data-testid={`nav-${s.id}`}
      >
        <span style={{ width: 28, height: 28, borderRadius: 8, flex: "none", background: on ? "linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B)" : "#FFFFFF", color: on ? "#0A0F0C" : (s.iconColor ?? "#5C6B62"), border: `1px solid ${on ? "rgba(0,0,0,.06)" : "#EAE3D5"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, boxSizing: "border-box" }}>{s.icon}</span>
        <span style={{ flex: 1 }}>{s.label}</span>
        {s.beta ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: "#1192A6", background: "rgba(54,215,237,.16)", borderRadius: 6, padding: "2px 7px" }}>BETA</span> : null}
      </div>
    );
  };

  return (
    // prototype renders at the browser-default line-height, not the app body's 1.5
    <div style={{ flex: 1, minWidth: 0, background: "#FBF7F0", display: "flex", flexDirection: "column", fontFamily: "'Hanken Grotesk',sans-serif", lineHeight: "normal" }} data-testid="settings-view">
      {/* page header */}
      <div style={{ padding: "26px 30px 0" }}>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 28, letterSpacing: "-.02em", color: "#0E1512" }}>Settings</div>
        <div style={{ fontSize: 15, color: "#5C6B62", marginBottom: 20 }}>Account, workspace and communication channels.</div>
      </div>

      <div style={{ display: "flex", gap: 26, padding: "0 30px 34px", alignItems: "flex-start" }}>
        {/* sub-nav rail */}
        <div style={{ flex: "0 0 226px", position: "sticky", top: 20 }} data-testid="settings-nav">
          <div style={{ background: "linear-gradient(168deg,#FFFFFF 0%,#FBF8F1 46%,#F3F7F3 100%)", border: "1px solid #EAE3D5", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 0 rgba(255,255,255,.7) inset,0 10px 30px rgba(14,21,18,.07)" }}>
            <div style={groupHead(false)}>Account</div>
            {ACCOUNT_NAV.map(navItem)}
            <div style={groupHead(true)}>Workspace</div>
            {WORKSPACE_NAV.map(navItem)}
            <div style={groupHead(true)}>Communication</div>
            {COMM_NAV.map(navItem)}
            <div onClick={() => setToast("Logging out…")} style={{ padding: "11px 18px", borderTop: "1px solid #F2EEE4", fontSize: 14, color: "#C9543F", fontWeight: 600, cursor: "pointer" }} data-testid="nav-logout">Log out</div>
          </div>
        </div>

        {/* content column */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: 1000 }}>
          {section === "profile" ? <ProfileSection toast={setToast} /> : null}
          {section === "billing" ? <BillingSection toast={setToast} /> : null}
          {section === "custom" ? <CustomFieldsSection toast={setToast} /> : null}
          {section === "team" ? <TeamSection toast={setToast} /> : null}
          {section === "brand" ? <BrandKit toast={setToast} /> : null}
          {section === "schedules" ? <SchedulesSection toast={setToast} /> : null}
          {section === "usage" ? <UsageSection /> : null}
          {section === "email" ? <EmailSendersSection toast={setToast} /> : null}
          {section === "mailer" ? <MailerSendersSection toast={setToast} /> : null}
          {section === "phone" ? <SmsSendersSection toast={setToast} /> : null}
          {section === "whatsapp" ? <WhatsappSection toast={setToast} /> : null}
          {section === "suppress" ? <SuppressionSection toast={setToast} /> : null}
        </div>
      </div>

      <Toast msg={toast} onDismiss={() => setToast("")} />
    </div>
  );
}
