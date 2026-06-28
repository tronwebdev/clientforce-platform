"use client";

import { useState } from "react";
import { Button, Card, Dropdown, Pill, Tabs, Toast, Toggle } from "@clientforce/ui";

const section = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--cf-space-12)",
  marginBottom: "var(--cf-space-32)",
};
const row = { display: "flex", gap: "var(--cf-space-16)", alignItems: "center", flexWrap: "wrap" as const };
const label = {
  fontFamily: "var(--cf-font-body)",
  fontSize: "var(--cf-text-12)",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--cf-color-muted-3)",
};

export default function DesignPage() {
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState("inbox");
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("recent");
  const [toast, setToast] = useState(true);

  return (
    <main style={{ padding: "var(--cf-space-40)", maxWidth: 920, margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--cf-text-28)", marginBottom: "var(--cf-space-8)" }}>
        Clientforce design system
      </h1>
      <p style={{ color: "var(--cf-color-muted-2)", marginTop: 0, marginBottom: "var(--cf-space-40)" }}>
        Base components rendered on canonical tokens (DESIGN_TOKENS.md §6).
      </p>

      <section style={section}>
        <span style={label}>Buttons</span>
        <div style={row}>
          <Button variant="primary">Create agent</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Send breakdown</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </section>

      <section style={section}>
        <span style={label}>Card</span>
        <Card style={{ maxWidth: 360 }}>
          <h3 style={{ margin: 0, fontSize: "var(--cf-text-18)" }}>New-patient booking</h3>
          <p style={{ color: "var(--cf-color-muted-2)", fontSize: "var(--cf-text-14)" }}>
            Goal-driven agent across email, SMS, and voice.
          </p>
          <div style={row}>
            <Pill tone="success">Active</Pill>
            <Pill tone="warn">Warming up</Pill>
            <Pill tone="neutral">Draft</Pill>
          </div>
        </Card>
      </section>

      <section style={section}>
        <span style={label}>Tabs</span>
        <Tabs
          label="Campaign view"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "inbox", label: "Inbox" },
            { value: "steps", label: "Steps" },
            { value: "leads", label: "Leads" },
            { value: "stats", label: "Stats" },
          ]}
        />
      </section>

      <section style={section}>
        <span style={label}>Dropdown</span>
        <Dropdown
          label="Sort: recent"
          header="Sort by"
          open={open}
          onToggle={() => setOpen((v) => !v)}
          value={sort}
          onSelect={(v) => {
            setSort(v);
            setOpen(false);
          }}
          items={[
            { value: "recent", label: "Most recent" },
            { value: "name", label: "Name" },
            { value: "stage", label: "Pipeline stage" },
          ]}
        />
      </section>

      <section style={section}>
        <span style={label}>Toggle</span>
        <div style={row}>
          <Toggle checked={on} onChange={setOn} label="Enable automation" />
          <span style={{ color: "var(--cf-color-muted-2)", fontSize: "var(--cf-text-14)" }}>
            Automation {on ? "on" : "off"}
          </span>
        </div>
      </section>

      <section style={section}>
        <span style={label}>Toast</span>
        <div style={row}>
          {toast ? <Toast onClose={() => setToast(false)}>Agent published successfully</Toast> : null}
          <Button variant="secondary" onClick={() => setToast(true)}>
            Show toast
          </Button>
        </div>
      </section>
    </main>
  );
}
