export interface NavItem {
  key: string;
  label: string;
  icon: string;
  href: string;
  badge?: string;
}

/** Primary nav — mirrors prototypes/sidebar.js. */
export const MAIN_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "◈", href: "/" },
  { key: "agents", label: "Agents", icon: "◎", href: "/agents" },
  { key: "contacts", label: "Contacts", icon: "☺", href: "/contacts" },
  { key: "stats", label: "Stats", icon: "▤", href: "/stats" },
  { key: "integrations", label: "Integrations", icon: "⚯", href: "/integrations" },
  { key: "automations", label: "Automations", icon: "⟳", href: "/automations" },
];

export const TOOLS_NAV: NavItem[] = [
  { key: "lead-finder", label: "Lead Finder", icon: "⌖", href: "/lead-finder", badge: "Auto Prospecting" },
  { key: "proposals", label: "Proposals", icon: "❒", href: "/proposals", badge: "Dynamic" },
  { key: "forms", label: "Forms", icon: "⊞", href: "/forms" },
  { key: "widget", label: "Agent Widget", icon: "⊕", href: "/widget" },
  { key: "linkedin", label: "LinkedIn Extension", icon: "in", href: "/linkedin" },
];

const TOOL_KEYS = new Set(TOOLS_NAV.map((t) => t.key));

/** Map a pathname to the active nav key. */
export function activeKeyFor(pathname: string): string {
  if (pathname === "/") return "dashboard";
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "settings") return "settings";
  if (TOOL_KEYS.has(seg)) return seg;
  return seg || "dashboard";
}

export function isToolKey(key: string): boolean {
  return TOOL_KEYS.has(key);
}
