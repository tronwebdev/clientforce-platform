/**
 * Embed entry — the drop-in bundle.
 *
 * Canonical snippet (the prototype Install-tab contract, verbatim shape):
 *
 *   <script
 *     src="https://cdn.clientforce.co/widget.js"
 *     data-widget-id="wgt_8fa3c21e"
 *     async>
 *   </script>
 *
 * Optional pre-load command queue (programmatic control; safe before load):
 *
 *   <script>
 *     window.ClientforceWidget = window.ClientforceWidget ||
 *       function () { (window.ClientforceWidget.q =
 *         window.ClientforceWidget.q || []).push(arguments); };
 *     ClientforceWidget("on", "ready", () => {});
 *     ClientforceWidget("open");
 *   </script>
 *
 * Explicit-queue `init` wins over the script tag's data-attributes; the tag
 * auto-inits only when no queued init ran. One instance per page.
 */
import { configFromScriptDataset, WIDGET_GLOBAL_NAME, type WidgetInitOptions } from "./config";
import {
  WidgetInstance,
  type WidgetEventName,
  type WidgetInstanceOptions,
  type WidgetUpdateOptions,
} from "./mount";

export const WIDGET_VERSION = "0.1.0";

export interface WidgetGlobal {
  (...args: unknown[]): void;
  q?: unknown[][];
  version: string;
  instance: () => WidgetInstance | null;
}

function warn(msg: string): void {
  console.warn(`[clientforce-widget] ${msg}`);
}

export function bootstrap(
  win: Window & typeof globalThis,
  instanceOpts: WidgetInstanceOptions = {},
): WidgetGlobal {
  const doc = instanceOpts.doc ?? win.document;
  let instance: WidgetInstance | null = null;

  function init(options: WidgetInitOptions): void {
    if (instance) {
      warn("already initialized — ignoring repeat init (destroy first to re-init)");
      return;
    }
    const run = (): void => {
      instance = new WidgetInstance(options, { ...instanceOpts, doc });
    };
    if (doc.body) run();
    else doc.addEventListener("DOMContentLoaded", run, { once: true });
  }

  function dispatch(...args: unknown[]): void {
    const [cmd, ...rest] = args;
    switch (cmd) {
      case "init":
        init(rest[0] as WidgetInitOptions);
        return;
      case "open":
        instance?.open();
        return;
      case "close":
        instance?.close();
        return;
      case "toggle":
        instance?.toggle();
        return;
      case "send":
        void instance?.send(String(rest[0] ?? ""));
        return;
      case "update":
        instance?.update((rest[0] ?? {}) as WidgetUpdateOptions);
        return;
      case "setAgentState":
        instance?.setAgentState(rest[0] as never);
        return;
      case "on":
        instance?.on(rest[0] as WidgetEventName, rest[1] as (p?: unknown) => void);
        return;
      case "off":
        instance?.off(rest[0] as WidgetEventName, rest[1] as (p?: unknown) => void);
        return;
      case "destroy":
        instance?.destroy();
        instance = null;
        return;
      default:
        warn(`unknown command ${JSON.stringify(cmd)}`);
    }
  }

  const g = win as unknown as Record<string, unknown>;
  const existing = g[WIDGET_GLOBAL_NAME] as WidgetGlobal | undefined;
  const pending: unknown[][] = existing && Array.isArray(existing.q) ? existing.q : [];

  const api = dispatch as WidgetGlobal;
  api.version = WIDGET_VERSION;
  api.instance = () => instance;
  g[WIDGET_GLOBAL_NAME] = api;

  // Replay queued commands in order; a queued ("on", …) before init is
  // meaningless (no instance) — buffer only init-first sequences work, so
  // re-queue non-init commands until after the first init.
  const preInit: unknown[][] = [];
  for (const args of pending) {
    if (args[0] === "init" || instance) dispatch(...args);
    else preInit.push(args);
  }

  // Auto-init from the snippet script tag when no queued init ran.
  if (!instance) {
    const current = doc.currentScript as HTMLScriptElement | null;
    const tag =
      current?.dataset?.widgetId !== undefined
        ? current
        : doc.querySelector<HTMLScriptElement>("script[data-widget-id]");
    if (tag?.dataset.widgetId) {
      try {
        init(configFromScriptDataset(tag.dataset));
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
      }
    }
  }

  for (const args of preInit) dispatch(...args);

  return api;
}

/* Browser side effect: define the global + auto-init. */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap(window);
}

export { WidgetInstance } from "./mount";
export type { WidgetEventName, WidgetUpdateOptions } from "./mount";
export * from "./config";
export * from "./api/contract";
export * from "./api/transport";
