import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AppDrawer,
  BulkBar,
  ChannelChip,
  DataTable,
  EmptyState,
  Modal,
  SegmentTabs,
  Skeleton,
  Stepper,
  type DataTableColumn,
} from "../src";

interface Row {
  id: string;
  name: string;
}
const columns: Array<DataTableColumn<Row>> = [
  { key: "name", header: "Contact", cell: (r) => r.name, sortable: true },
  { key: "id", header: "Id", cell: (r) => r.id },
];
const rows: Row[] = [
  { id: "1", name: "Ada" },
  { id: "2", name: "Grace" },
];

describe("AppDrawer", () => {
  it("renders nothing closed; dialog + width variant + header band open", () => {
    expect(
      renderToStaticMarkup(
        <AppDrawer open={false} title="Lead">
          x
        </AppDrawer>,
      ),
    ).toBe("");
    const html = renderToStaticMarkup(
      <AppDrawer open width={500} title="Sender detail" subtitle="cf-mailer">
        body
      </AppDrawer>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("cf-drawer--500");
    expect(html).toContain("Sender detail");
    expect(html).toContain('aria-label="Close"');
  });

  it("defaults to the 460 lead-drawer variant", () => {
    const html = renderToStaticMarkup(<AppDrawer open title="Lead" />);
    expect(html).toContain("cf-drawer--460");
  });
});

describe("Modal", () => {
  it("renders header/body/footer anatomy with the volume-modal skin", () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        title="Daily sending limits"
        subtitle="Adjust caps"
        footer={<button>Save</button>}
      >
        content
      </Modal>,
    );
    expect(html).toContain("cf-modal__header");
    expect(html).toContain("cf-modal__footer");
    expect(html).toContain("Daily sending limits");
    expect(html).not.toContain("cf-modal--surface");
    expect(renderToStaticMarkup(<Modal open title="CSV" skin="surface" />)).toContain(
      "cf-modal--surface",
    );
  });
});

describe("DataTable", () => {
  it("renders headers, rows, selection checkboxes and sort state", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        gridTemplate="46px 1fr 1fr"
        selectable
        selected={new Set(["1"])}
        sortKey="name"
        sortDirection="asc"
      />,
    );
    expect(html).toContain("Contact");
    expect(html).toContain("Ada");
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("cf-table__row--selected");
    expect(html).toContain('aria-checked="mixed"'); // header tri-state: 1 of 2
  });

  it("shows skeleton rows while loading and the empty slot when empty", () => {
    const loading = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        gridTemplate="1fr 1fr"
        loading
      />,
    );
    expect(loading).toContain("cf-skeleton");
    const empty = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        gridTemplate="1fr 1fr"
        empty={<EmptyState title="No contacts yet" />}
      />,
    );
    expect(empty).toContain("No contacts yet");
  });
});

describe("SegmentTabs", () => {
  it("marks the active segment and renders count pills", () => {
    const html = renderToStaticMarkup(
      <SegmentTabs
        value="replied"
        segments={[
          { value: "all", label: "All", count: 12 },
          { value: "replied", label: "Replied", count: 3 },
        ]}
      />,
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("cf-segment--active");
    expect(html).toContain(">3<");
  });
});

describe("BulkBar", () => {
  it("renders count, clear and danger action styling", () => {
    const html = renderToStaticMarkup(
      <BulkBar
        count={2}
        actions={[
          { key: "export", label: "↥ Export" },
          { key: "delete", label: "Delete", danger: true },
        ]}
      />,
    );
    expect(html).toContain("2 selected");
    expect(html).toContain("Clear");
    expect(html).toContain("cf-bulkbar__action--danger");
  });
});

describe("ChannelChip", () => {
  it("renders chip + icon variants with channel classes", () => {
    expect(renderToStaticMarkup(<ChannelChip channel="email" />)).toContain("cf-chip--email");
    expect(renderToStaticMarkup(<ChannelChip channel="voice" variant="icon" />)).toContain(
      "cf-chip--icon",
    );
    expect(renderToStaticMarkup(<ChannelChip channel="email" label="Email · Step 2" />)).toContain(
      "Email · Step 2",
    );
  });
});

describe("Stepper", () => {
  it("disables the decrement at min and formats tabular value", () => {
    const html = renderToStaticMarkup(
      <Stepper value={50} min={50} max={500} label="Daily email cap" />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain(">50<");
    const big = renderToStaticMarkup(<Stepper value={1000} label="cap" />);
    expect(big).toContain("1,000");
  });
});

describe("Skeleton + EmptyState", () => {
  it("renders shimmer with dimensions and empty-state kinds", () => {
    expect(renderToStaticMarkup(<Skeleton width={120} height={12} />)).toContain("cf-skeleton");
    const filtered = renderToStaticMarkup(
      <EmptyState
        kind="filtered"
        glyph="🔍"
        title="No contacts match"
        body="Try clearing filters."
      />,
    );
    expect(filtered).toContain('data-kind="filtered"');
    expect(filtered).toContain("No contacts match");
  });
});
