export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange?: (value: string) => void;
  label?: string;
}

/** Controlled tab bar — active tab is an ink fill with white text (§6). */
export function Tabs({ tabs, value, onChange, label }: TabsProps) {
  return (
    <div className="cf-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={["cf-tab", active ? "cf-tab--active" : ""].filter(Boolean).join(" ")}
            onClick={() => onChange?.(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
