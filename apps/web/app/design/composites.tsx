"use client";

import { useState } from "react";
import {
  AppDrawer,
  BulkBar,
  Button,
  ChannelChip,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  SegmentTabs,
  Skeleton,
  Stepper,
  type DataTableColumn,
  type DrawerWidth,
} from "@clientforce/ui";

const section = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--cf-space-12)",
  marginBottom: "var(--cf-space-32)",
};
const row = {
  display: "flex",
  gap: "var(--cf-space-16)",
  alignItems: "center",
  flexWrap: "wrap" as const,
};
const label = {
  fontFamily: "var(--cf-font-body)",
  fontSize: "var(--cf-text-12)",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--cf-color-muted-3)",
};

interface DemoRow {
  id: string;
  name: string;
  email: string;
  company: string;
  status: string;
}

const DEMO_ROWS: DemoRow[] = [
  {
    id: "1",
    name: "Ada Lovelace",
    email: "ada@demo-agency.test",
    company: "Analytical Engines",
    status: "Replied",
  },
  {
    id: "2",
    name: "Alan Turing",
    email: "alan@demo-agency.test",
    company: "Bletchley Park",
    status: "New",
  },
  {
    id: "3",
    name: "Grace Hopper",
    email: "grace@demo-agency.test",
    company: "UNIVAC",
    status: "Booked",
  },
];

const columns: Array<DataTableColumn<DemoRow>> = [
  {
    key: "name",
    header: "Contact",
    sortable: true,
    cell: (r) => (
      <span>
        <span style={{ display: "block", fontWeight: 600, fontSize: "14.5px" }}>{r.name}</span>
        <span style={{ display: "block", fontSize: "12.5px", color: "var(--cf-color-muted)" }}>
          {r.email}
        </span>
      </span>
    ),
  },
  { key: "company", header: "Company", cell: (r) => r.company },
  {
    key: "status",
    header: "Status",
    sortable: true,
    cell: (r) => <Pill tone={r.status === "Booked" ? "success" : "neutral"}>{r.status}</Pill>,
  },
];

/** C1 composite demos — one section per component, every state reachable. */
export function CompositesDemo() {
  const [drawer, setDrawer] = useState<DrawerWidth | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tableState, setTableState] = useState<"default" | "loading" | "empty" | "error">(
    "default",
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["1"]));
  const [segment, setSegment] = useState("all");
  const [cap, setCap] = useState(200);

  const toggleRow = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <section style={section}>
        <span style={label}>AppDrawer (460 · 480 · 500)</span>
        <div style={row}>
          {([460, 480, 500] as const).map((w) => (
            <Button
              key={w}
              variant="secondary"
              data-testid={`open-drawer-${w}`}
              onClick={() => setDrawer(w)}
            >
              Open {w}px drawer
            </Button>
          ))}
        </div>
        <AppDrawer
          open={drawer !== null}
          width={drawer ?? 460}
          onClose={() => setDrawer(null)}
          title={
            drawer === 500 ? "Sender detail" : drawer === 480 ? "Add contact" : "Rachel Alvarez"
          }
          subtitle={
            drawer === 500
              ? "agent@send.clientforce.io"
              : drawer === 480
                ? "Create a single contact"
                : "rachel@harborcare.test"
          }
          headerExtra={drawer === 460 ? <Pill tone="success">Interested</Pill> : undefined}
        >
          <p
            style={{
              marginTop: 0,
              fontSize: "var(--cf-text-14)",
              color: "var(--cf-color-muted-2)",
            }}
          >
            Drawer body content — the C2 screens compose timelines, forms, and detail blocks in
            here.
          </p>
          <Button variant="primary">Primary action</Button>
        </AppDrawer>
      </section>

      <section style={section}>
        <span style={label}>Modal (volume/limits anatomy + Stepper)</span>
        <div style={row}>
          <Button variant="secondary" data-testid="open-modal" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Daily sending limits"
          subtitle="Adjust caps per channel to protect deliverability."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                Save limits
              </Button>
            </>
          }
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--cf-space-12)",
              background: "var(--cf-color-surface)",
              border: "1px solid var(--cf-color-hairline)",
              borderRadius: 13,
              padding: "13px 15px",
            }}
          >
            <ChannelChip channel="email" variant="icon" />
            <span style={{ fontSize: "var(--cf-text-14)", fontWeight: 600, flex: 1 }}>
              Email / day
            </span>
            <Stepper
              value={cap}
              onChange={setCap}
              min={50}
              max={1000}
              step={50}
              label="Daily email cap"
            />
          </div>
        </Modal>
      </section>

      <section style={section}>
        <span style={label}>DataTable (default · loading · empty · error)</span>
        <div style={row}>
          {(["default", "loading", "empty", "error"] as const).map((s) => (
            <Button
              key={s}
              variant={tableState === s ? "primary" : "secondary"}
              data-testid={`table-${s}`}
              onClick={() => setTableState(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        {selected.size > 0 && tableState === "default" ? (
          <BulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            actions={[
              { key: "sequence", label: "+ Add to sequence" },
              { key: "export", label: "Export" },
              { key: "unsub", label: "Unsubscribe", danger: true },
            ]}
          />
        ) : null}
        <DataTable
          columns={columns}
          rows={tableState === "empty" || tableState === "error" ? [] : DEMO_ROWS}
          rowKey={(r) => r.id}
          gridTemplate="46px minmax(0,1.9fr) 1.2fr .95fr 44px"
          loading={tableState === "loading"}
          selectable
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={() =>
            setSelected(
              selected.size === DEMO_ROWS.length ? new Set() : new Set(DEMO_ROWS.map((r) => r.id)),
            )
          }
          sortKey="name"
          sortDirection="asc"
          rowMenu={() => "⋯"}
          error={
            tableState === "error" ? (
              <EmptyState
                glyph="⚠"
                title="Couldn't load contacts"
                body="Something went wrong on our side."
                actions={<Button variant="secondary">Retry</Button>}
              />
            ) : undefined
          }
          empty={
            <EmptyState
              kind="filtered"
              glyph="🔍"
              title="No contacts match"
              body="Try clearing filters, or find fresh leads to add."
              actions={
                <>
                  <Button variant="secondary">Reset filters</Button>
                  <Button variant="primary">Find leads</Button>
                </>
              }
            />
          }
          footer={<span>Showing 1–3 of 3</span>}
        />
      </section>

      <section style={section}>
        <span style={label}>SegmentTabs</span>
        <SegmentTabs
          value={segment}
          onChange={setSegment}
          segments={[
            { value: "all", label: "All", count: 12 },
            { value: "new", label: "New", count: 5 },
            { value: "replied", label: "Replied", count: 3 },
            { value: "qualified", label: "Qualified", count: 2 },
            { value: "booked", label: "Booked", count: 1 },
            { value: "unsub", label: "Unsub", count: 1 },
          ]}
        />
      </section>

      <section style={section}>
        <span style={label}>ChannelChip (chip + icon variants)</span>
        <div style={row}>
          <ChannelChip channel="email" />
          <ChannelChip channel="sms" />
          <ChannelChip channel="whatsapp" />
          <ChannelChip channel="voice" />
          <ChannelChip channel="email" label="Email · Step 2" />
          <ChannelChip channel="email" variant="icon" />
          <ChannelChip channel="sms" variant="icon" />
          <ChannelChip channel="voice" variant="icon" />
        </div>
      </section>

      <section style={section}>
        <span style={label}>Stepper (enabled · at-min · disabled)</span>
        <div style={row}>
          <Stepper
            value={cap}
            onChange={setCap}
            min={50}
            max={1000}
            step={50}
            label="Daily email cap"
          />
          <Stepper value={50} min={50} label="At minimum" />
          <Stepper value={200} disabled label="Disabled" />
        </div>
      </section>

      <section style={section}>
        <span style={label}>Skeleton</span>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--cf-space-8)",
            maxWidth: 360,
          }}
        >
          <div style={row}>
            <Skeleton width={36} height={36} round />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton height={12} width="60%" />
              <Skeleton height={10} width="40%" />
            </div>
          </div>
          <Skeleton height={12} />
          <Skeleton height={12} width="80%" />
        </div>
      </section>

      <section style={section}>
        <span style={label}>EmptyState (true-empty vs filtered-empty)</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--cf-space-16)" }}>
          <div
            style={{
              background: "var(--cf-color-surface)",
              border: "1px solid var(--cf-color-hairline)",
              borderRadius: 18,
            }}
          >
            <EmptyState
              glyph="✨"
              title="No agents yet"
              body="Create your first agent to start booking meetings."
              actions={<Button variant="primary">New agent</Button>}
            />
          </div>
          <div
            style={{
              background: "var(--cf-color-surface)",
              border: "1px solid var(--cf-color-hairline)",
              borderRadius: 18,
            }}
          >
            <EmptyState
              kind="filtered"
              glyph="🔍"
              title="No contacts match"
              body="Try clearing filters, or find fresh leads to add."
              actions={<Button variant="secondary">Reset filters</Button>}
            />
          </div>
        </div>
      </section>
    </>
  );
}
