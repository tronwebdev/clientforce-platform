/**
 * Widget config surface — which agent/campaign the widget maps to plus basic
 * appearance/behavior. Defaults are the Agent Widget prototype's own defaults
 * (design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html state) —
 * ported, not invented.
 *
 * Precedence (lowest → highest): DEFAULTS → snippet data-attributes → JS
 * `ClientforceWidget('init', …)` options → (future) server-resolved config
 * from the boot response, which is authoritative once the backend wiring unit
 * lands (the widgetId → agent/campaign mapping lives server-side; the
 * client-side agentId/campaignId fields are preview/dev overrides only).
 */
import { DEFAULT_AGENT_NAME, consoleV3 } from "@clientforce/theme";

export const WIDGET_GLOBAL_NAME = "ClientforceWidget";

export type WidgetPosition = "left" | "right";
/** Canon §7: the v3 widget is LIGHT-FIRST — there is no dark canon. A dark
 * theme would be a new design decision, so "dark" is not offered (passing it
 * warns and falls back to light rather than rendering an un-canon'd skin). */
export type WidgetTheme = "light";
/** Prototype "Corners" options XL/L/M/S/None. */
export type WidgetCorner = "xl" | "l" | "m" | "s" | "none";
export type FontLoading = "none" | "google";

/** The prototype's Corners option set on the Console v3 radii scale. `l` is the
 * SHIPPED DEFAULT and carries the owner's panel geometry (radius 20, ruling
 * 2026-07-26); the rest stay on the canon scale. The legacy 28/20/14/8
 * prototype values are retired. */
export const CORNER_RADIUS_PX: Record<WidgetCorner, number> = {
  xl: 22,
  l: 20,
  m: 12,
  s: 9,
  none: 0,
};

/**
 * The six widget FLOWS. Each is independently enabled per workspace in widget
 * setup — industries use different subsets, and the panel renders only the
 * active ones (no placeholder for a disabled flow). This is ungated WORKSPACE
 * configuration, the same layer as the accent color and the logo — it is NOT
 * plan-gated (only the platform-attribution line is; see the contract's
 * `branding`, which is server-authoritative and has no client knob).
 */
export interface WidgetFlows {
  bookVisit: boolean;
  callMeBack: boolean;
  scheduleCallback: boolean;
  estimate: boolean;
  /** Rides the composer mic rather than an entry chip. */
  liveVoice: boolean;
  askQuestion: boolean;
}

export interface WidgetAppearance {
  /** Brand fill for header/launcher/send. Prototype default = forest accent. */
  brandColor: string;
  /** "auto" resolves via the prototype's ink() luminance rule. */
  textOnBrand: "auto" | string;
  launcherText: string;
  subtitle: string;
  welcomeMessage: string;
  showUnreadBadge: boolean;
  theme: WidgetTheme;
  corner: WidgetCorner;
  position: WidgetPosition;
}

export interface WidgetBehavior {
  /** Prototype "Open after 4s" toggle → seconds, or null = off. */
  openAfterSeconds: number | null;
  /** Prototype "Exit intent" toggle. */
  exitIntent: boolean;
}

/** What `('init', …)` / snippet data-attributes accept. */
export interface WidgetInitOptions {
  widgetId: string;
  /** Preview/dev override; authoritative mapping is server-side by widgetId. */
  agentId?: string;
  /** Preview/dev override; authoritative mapping is server-side by widgetId. */
  campaignId?: string;
  /** API origin for the session seam. Absent → stubbed transport (this unit). */
  apiBase?: string;
  /** Header title. Server-resolved once the wiring unit lands. */
  agentName?: string;
  /** The tenant's business name — used by the default welcome copy and the
   * header subtitle. Server-resolved once the wiring unit lands. */
  businessName?: string;
  zIndex?: number;
  /** "google" injects the brand font stylesheet into the host document head.
   * Default "none": the embed makes zero third-party requests. */
  fontLoading?: FontLoading;
  appearance?: Partial<WidgetAppearance>;
  behavior?: Partial<WidgetBehavior>;
  flows?: Partial<WidgetFlows>;
}

export interface ResolvedWidgetConfig {
  widgetId: string;
  agentId: string | null;
  campaignId: string | null;
  apiBase: string | null;
  agentName: string;
  businessName: string | null;
  zIndex: number;
  fontLoading: FontLoading;
  appearance: WidgetAppearance;
  behavior: WidgetBehavior;
  flows: WidgetFlows;
}

/**
 * The canon welcome line (owner copy, 2026-07-26) — emoji retired here too, not
 * just in iconography. Derived so it names the agent and, when known, the
 * business: "Hi — I'm Ada, Bright Smile's assistant. I can book you in, call
 * you back, send an estimate, or answer a question."
 */
export function defaultWelcome(agentName: string, businessName: string | null): string {
  const whose = businessName ? `${businessName}'s` : "your";
  return `Hi — I'm ${agentName}, ${whose} assistant. I can book you in, call you back, send an estimate, or answer a question.`;
}

/** Prototype defaults, on the canon copy/geometry where the owner has ruled. */
export const WIDGET_DEFAULTS: Omit<ResolvedWidgetConfig, "widgetId"> = {
  agentId: null,
  campaignId: null,
  apiBase: null,
  agentName: DEFAULT_AGENT_NAME,
  businessName: null,
  zIndex: 2147483000,
  fontLoading: "none",
  appearance: {
    brandColor: consoleV3.forest,
    textOnBrand: "auto",
    launcherText: "Chat with our AI Sales Agent",
    subtitle: "AI Sales Assistant",
    welcomeMessage: defaultWelcome(DEFAULT_AGENT_NAME, null),
    showUnreadBadge: true,
    theme: "light",
    corner: "l",
    position: "right",
  },
  behavior: {
    openAfterSeconds: 4,
    exitIntent: false,
  },
  flows: {
    bookVisit: true,
    callMeBack: true,
    scheduleCallback: true,
    estimate: true,
    liveVoice: true,
    askQuestion: true,
  },
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function warn(msg: string): void {
  console.warn(`[clientforce-widget] ${msg}`);
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  warn(`invalid ${field} ${JSON.stringify(value)} — using ${JSON.stringify(fallback)}`);
  return fallback;
}

function pickColor(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && HEX_COLOR.test(value)) return value;
  warn(
    `invalid ${field} ${JSON.stringify(value)} — expected #rgb/#rrggbb, using ${JSON.stringify(fallback)}`,
  );
  return fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function pickNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return n;
  warn(`invalid ${field} ${JSON.stringify(value)} — using ${fallback}`);
  return fallback;
}

export function resolveConfig(init: WidgetInitOptions): ResolvedWidgetConfig {
  const d = WIDGET_DEFAULTS;
  const a = init.appearance ?? {};
  const b = init.behavior ?? {};
  const f = init.flows ?? {};
  if (typeof init.widgetId !== "string" || init.widgetId.length === 0) {
    throw new Error("[clientforce-widget] init requires a widgetId (wgt_…)");
  }
  const textOnBrand =
    a.textOnBrand === undefined || a.textOnBrand === "auto"
      ? "auto"
      : pickColor(a.textOnBrand, "appearance.textOnBrand", d.appearance.brandColor) ===
          a.textOnBrand
        ? a.textOnBrand
        : "auto";
  return {
    widgetId: init.widgetId,
    agentId: pickString(init.agentId, "") || null,
    campaignId: pickString(init.campaignId, "") || null,
    apiBase: pickString(init.apiBase, "") || null,
    agentName: pickString(init.agentName, d.agentName),
    businessName: pickString(init.businessName, "") || null,
    zIndex: pickNumber(init.zIndex, "zIndex", d.zIndex),
    fontLoading: pickEnum(
      init.fontLoading,
      ["none", "google"] as const,
      "fontLoading",
      d.fontLoading,
    ),
    appearance: {
      brandColor: pickColor(a.brandColor, "appearance.brandColor", d.appearance.brandColor),
      textOnBrand,
      launcherText: pickString(a.launcherText, d.appearance.launcherText),
      subtitle: pickString(a.subtitle, d.appearance.subtitle),
      welcomeMessage: pickString(
        a.welcomeMessage,
        defaultWelcome(
          pickString(init.agentName, d.agentName),
          pickString(init.businessName, "") || null,
        ),
      ),
      showUnreadBadge: pickBool(a.showUnreadBadge, d.appearance.showUnreadBadge),
      theme: pickEnum(a.theme, ["light"] as const, "appearance.theme", d.appearance.theme),
      corner: pickEnum(
        a.corner,
        ["xl", "l", "m", "s", "none"] as const,
        "appearance.corner",
        d.appearance.corner,
      ),
      position: pickEnum(
        a.position,
        ["left", "right"] as const,
        "appearance.position",
        d.appearance.position,
      ),
    },
    behavior: {
      openAfterSeconds:
        b.openAfterSeconds === null
          ? null
          : b.openAfterSeconds === undefined
            ? d.behavior.openAfterSeconds
            : Math.max(
                0,
                pickNumber(
                  b.openAfterSeconds,
                  "behavior.openAfterSeconds",
                  d.behavior.openAfterSeconds ?? 4,
                ),
              ),
      exitIntent: pickBool(b.exitIntent, d.behavior.exitIntent),
    },
    flows: {
      bookVisit: pickBool(f.bookVisit, d.flows.bookVisit),
      callMeBack: pickBool(f.callMeBack, d.flows.callMeBack),
      scheduleCallback: pickBool(f.scheduleCallback, d.flows.scheduleCallback),
      estimate: pickBool(f.estimate, d.flows.estimate),
      liveVoice: pickBool(f.liveVoice, d.flows.liveVoice),
      askQuestion: pickBool(f.askQuestion, d.flows.askQuestion),
    },
  };
}

/**
 * Snippet data-attribute surface. The canonical snippet needs only
 * data-widget-id; everything else is optional override.
 */
export function configFromScriptDataset(ds: DOMStringMap): WidgetInitOptions {
  const init: WidgetInitOptions = { widgetId: ds.widgetId ?? "" };
  if (ds.agentId) init.agentId = ds.agentId;
  if (ds.campaignId) init.campaignId = ds.campaignId;
  if (ds.apiBase) init.apiBase = ds.apiBase;
  if (ds.agentName) init.agentName = ds.agentName;
  if (ds.businessName) init.businessName = ds.businessName;
  if (ds.zIndex !== undefined) init.zIndex = Number(ds.zIndex);
  if (ds.fontLoading) init.fontLoading = ds.fontLoading as FontLoading;

  const appearance: Partial<WidgetAppearance> = {};
  if (ds.brandColor) appearance.brandColor = ds.brandColor;
  if (ds.textOnBrand) appearance.textOnBrand = ds.textOnBrand;
  if (ds.launcherText) appearance.launcherText = ds.launcherText;
  if (ds.subtitle) appearance.subtitle = ds.subtitle;
  if (ds.welcomeMessage) appearance.welcomeMessage = ds.welcomeMessage;
  if (ds.unreadBadge !== undefined) appearance.showUnreadBadge = ds.unreadBadge === "true";
  if (ds.theme) appearance.theme = ds.theme as WidgetTheme;
  if (ds.corner) appearance.corner = ds.corner as WidgetCorner;
  if (ds.position) appearance.position = ds.position as WidgetPosition;
  if (Object.keys(appearance).length > 0) init.appearance = appearance;

  const behavior: Partial<WidgetBehavior> = {};
  if (ds.openAfter !== undefined) {
    behavior.openAfterSeconds = ds.openAfter === "off" ? null : Number(ds.openAfter);
  }
  if (ds.exitIntent !== undefined) behavior.exitIntent = ds.exitIntent === "true";
  if (Object.keys(behavior).length > 0) init.behavior = behavior;

  const flows: Partial<WidgetFlows> = {};
  if (ds.flowBookVisit !== undefined) flows.bookVisit = ds.flowBookVisit !== "false";
  if (ds.flowCallMeBack !== undefined) flows.callMeBack = ds.flowCallMeBack !== "false";
  if (ds.flowScheduleCallback !== undefined)
    flows.scheduleCallback = ds.flowScheduleCallback !== "false";
  if (ds.flowEstimate !== undefined) flows.estimate = ds.flowEstimate !== "false";
  if (ds.flowLiveVoice !== undefined) flows.liveVoice = ds.flowLiveVoice !== "false";
  if (ds.flowAskQuestion !== undefined) flows.askQuestion = ds.flowAskQuestion !== "false";
  if (Object.keys(flows).length > 0) init.flows = flows;

  return init;
}
