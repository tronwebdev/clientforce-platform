import type { CSSProperties, ReactNode } from "react";
import { Skeleton } from "./Skeleton";

export type SortDirection = "asc" | "desc";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Renders the cell for a row; wrapped in the standard cell styling. */
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  /** e.g. "46px minmax(0,1.9fr) 1.2fr …" — each screen owns its grid (checkpoints). */
  gridTemplate: string;
  loading?: boolean;
  /** Rendered inside the card when rows are empty and not loading. */
  empty?: ReactNode;
  /** Error state (with retry), rendered inside the card. */
  error?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** Selection (adds the 46px checkbox column; caller includes it in gridTemplate). */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onToggleRow?: (key: string) => void;
  onToggleAll?: () => void;
  /** Sort indicators on sortable headers. */
  sortKey?: string;
  sortDirection?: SortDirection;
  onSort?: (key: string) => void;
  /** Row menu (⋯) — adds the trailing 44px cell; caller includes it in gridTemplate. */
  rowMenu?: (row: Row) => ReactNode;
  onRowMenu?: (row: Row) => void;
  footer?: ReactNode;
  skeletonRows?: number;
}

function Checkbox({
  state,
  onClick,
  label,
}: {
  state: "off" | "on" | "mixed";
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state === "on"}
      aria-label={label}
      className={`cf-checkbox${state === "on" ? " cf-checkbox--checked" : ""}${state === "mixed" ? " cf-checkbox--mixed" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {state === "on" ? "✓" : state === "mixed" ? "–" : ""}
    </button>
  );
}

/**
 * Table anatomy from the Contacts prototype: card radius 18 + table shadow,
 * #FBF7F0 header band with 1.5px hairline, 12px/700 uppercase headers with
 * green sort arrows, 1px soft row separators + hover tint, 18px checkboxes
 * with 2px borders, ⋯ row menu, footer band. Grid template comes from the
 * caller — the anatomy is shared, the columns are the screen's.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  gridTemplate,
  loading = false,
  empty,
  error,
  onRowClick,
  selectable = false,
  selected,
  onToggleRow,
  onToggleAll,
  sortKey,
  sortDirection,
  onSort,
  rowMenu,
  onRowMenu,
  footer,
  skeletonRows = 5,
}: DataTableProps<Row>) {
  const gridStyle = { "--cf-table-grid": gridTemplate } as CSSProperties;
  const allState: "off" | "on" | "mixed" =
    !selected || selected.size === 0
      ? "off"
      : selected.size >= rows.length && rows.length > 0
        ? "on"
        : "mixed";

  return (
    <div className="cf-table-card" style={gridStyle} data-testid="cf-table">
      <div className="cf-table__head" role="row">
        {selectable ? (
          <div className="cf-table__checkcell">
            <Checkbox state={allState} onClick={onToggleAll} label="Select all rows" />
          </div>
        ) : null}
        {columns.map((col) =>
          col.sortable ? (
            <button
              key={col.key}
              type="button"
              className="cf-table__th cf-table__th--sortable"
              aria-sort={
                sortKey === col.key
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
              onClick={() => onSort?.(col.key)}
            >
              {col.header}{" "}
              <span className="cf-table__sort" aria-hidden="true">
                {sortKey === col.key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
              </span>
            </button>
          ) : (
            <div key={col.key} className="cf-table__th">
              {col.header}
            </div>
          ),
        )}
        {rowMenu ? <div /> : null}
      </div>

      {error ? (
        <div role="alert">{error}</div>
      ) : loading ? (
        Array.from({ length: skeletonRows }, (_v, i) => (
          <div
            key={i}
            className="cf-table__row"
            aria-hidden="true"
            data-testid="cf-table-skeleton-row"
          >
            {selectable ? (
              <div className="cf-table__checkcell">
                <Skeleton width={18} height={18} />
              </div>
            ) : null}
            {columns.map((col) => (
              <div key={col.key} className="cf-table__cell">
                <Skeleton height={12} width="70%" />
              </div>
            ))}
            {rowMenu ? <div /> : null}
          </div>
        ))
      ) : rows.length === 0 ? (
        empty
      ) : (
        rows.map((row) => {
          const key = rowKey(row);
          const isSelected = selected?.has(key) ?? false;
          return (
            <div
              key={key}
              className={`cf-table__row${isSelected ? " cf-table__row--selected" : ""}`}
              role="row"
              onClick={() => onRowClick?.(row)}
            >
              {selectable ? (
                <div className="cf-table__checkcell">
                  <Checkbox
                    state={isSelected ? "on" : "off"}
                    onClick={() => onToggleRow?.(key)}
                    label={`Select row ${key}`}
                  />
                </div>
              ) : null}
              {columns.map((col) => (
                <div key={col.key} className="cf-table__cell">
                  {col.cell(row)}
                </div>
              ))}
              {rowMenu ? (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="cf-table__menu"
                    aria-label="Row actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRowMenu?.(row);
                    }}
                  >
                    {rowMenu(row)}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {footer ? <div className="cf-table__footer">{footer}</div> : null}
    </div>
  );
}
