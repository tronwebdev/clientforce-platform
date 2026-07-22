import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORNER_RADIUS_PX,
  WIDGET_DEFAULTS,
  configFromScriptDataset,
  resolveConfig,
} from "../src/config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defaults (Agent Widget prototype state, ported verbatim)", () => {
  it("pins the prototype's appearance defaults", () => {
    expect(WIDGET_DEFAULTS.appearance).toEqual({
      brandColor: "#16a82a",
      textOnBrand: "auto",
      launcherText: "Chat with our AI Sales Agent",
      subtitle: "AI Sales Assistant",
      welcomeMessage: "Hi! 👋 How can I help?",
      showUnreadBadge: true,
      theme: "light",
      corner: "l",
      position: "right",
    });
  });

  it("pins the prototype's corner radius map (XL/L/M/S/None)", () => {
    expect(CORNER_RADIUS_PX).toEqual({ xl: 28, l: 20, m: 14, s: 8, none: 0 });
  });

  it("pins behavior + feature defaults (Open after 4s on, exit intent off, all features on)", () => {
    expect(WIDGET_DEFAULTS.behavior).toEqual({ openAfterSeconds: 4, exitIntent: false });
    expect(WIDGET_DEFAULTS.features).toEqual({
      bookCall: true,
      callMeBack: true,
      voiceChat: true,
      proposal: true,
    });
  });
});

describe("resolveConfig", () => {
  it("requires a widgetId", () => {
    expect(() => resolveConfig({ widgetId: "" })).toThrow(/widgetId/);
  });

  it("fills defaults and applies overrides with init precedence", () => {
    const cfg = resolveConfig({
      widgetId: "wgt_test",
      agentId: "agt_1",
      appearance: { position: "left", brandColor: "#0E1512" },
      behavior: { openAfterSeconds: null },
      features: { callMeBack: false },
    });
    expect(cfg.widgetId).toBe("wgt_test");
    expect(cfg.agentId).toBe("agt_1");
    expect(cfg.campaignId).toBeNull();
    expect(cfg.apiBase).toBeNull();
    expect(cfg.appearance.position).toBe("left");
    expect(cfg.appearance.brandColor).toBe("#0E1512");
    expect(cfg.appearance.theme).toBe("light");
    expect(cfg.behavior.openAfterSeconds).toBeNull();
    expect(cfg.behavior.exitIntent).toBe(false);
    expect(cfg.features).toEqual({
      bookCall: true,
      callMeBack: false,
      voiceChat: true,
      proposal: true,
    });
  });

  it("warns and falls back on invalid enum / color / number values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      widgetId: "wgt_test",
      zIndex: Number.NaN,
      appearance: {
        position: "top" as never,
        theme: "sepia" as never,
        corner: "round" as never,
        brandColor: "green",
      },
    });
    expect(cfg.zIndex).toBe(WIDGET_DEFAULTS.zIndex);
    expect(cfg.appearance.position).toBe("right");
    expect(cfg.appearance.theme).toBe("light");
    expect(cfg.appearance.corner).toBe("l");
    expect(cfg.appearance.brandColor).toBe("#16a82a");
    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn.mock.calls.every(([m]) => String(m).startsWith("[clientforce-widget]"))).toBe(true);
  });

  it("accepts #rgb and #rrggbb brand colors", () => {
    expect(
      resolveConfig({ widgetId: "w", appearance: { brandColor: "#0f0" } }).appearance.brandColor,
    ).toBe("#0f0");
    expect(
      resolveConfig({ widgetId: "w", appearance: { brandColor: "#0F7A28" } }).appearance.brandColor,
    ).toBe("#0F7A28");
  });
});

describe("configFromScriptDataset (snippet data-attributes)", () => {
  it("maps the canonical minimal snippet", () => {
    const init = configFromScriptDataset({ widgetId: "wgt_8fa3c21e" } as DOMStringMap);
    expect(init).toEqual({ widgetId: "wgt_8fa3c21e" });
  });

  it("maps the full attribute surface", () => {
    const init = configFromScriptDataset({
      widgetId: "wgt_1",
      agentId: "agt_1",
      campaignId: "cmp_1",
      apiBase: "https://api.example.test",
      agentName: "Acme Sales Agent",
      zIndex: "5000",
      fontLoading: "google",
      brandColor: "#0F7A28",
      launcherText: "Talk to us",
      subtitle: "Here to help",
      welcomeMessage: "Hello!",
      unreadBadge: "false",
      theme: "dark",
      corner: "s",
      position: "left",
      openAfter: "off",
      exitIntent: "true",
      featureCallMeBack: "false",
      featureVoiceChat: "false",
    } as unknown as DOMStringMap);
    const cfg = resolveConfig(init);
    expect(cfg.agentId).toBe("agt_1");
    expect(cfg.campaignId).toBe("cmp_1");
    expect(cfg.apiBase).toBe("https://api.example.test");
    expect(cfg.agentName).toBe("Acme Sales Agent");
    expect(cfg.zIndex).toBe(5000);
    expect(cfg.fontLoading).toBe("google");
    expect(cfg.appearance).toMatchObject({
      brandColor: "#0F7A28",
      launcherText: "Talk to us",
      subtitle: "Here to help",
      welcomeMessage: "Hello!",
      showUnreadBadge: false,
      theme: "dark",
      corner: "s",
      position: "left",
    });
    expect(cfg.behavior).toEqual({ openAfterSeconds: null, exitIntent: true });
    expect(cfg.features).toEqual({
      bookCall: true,
      callMeBack: false,
      voiceChat: false,
      proposal: true,
    });
  });

  it("parses numeric open-after seconds", () => {
    const cfg = resolveConfig(
      configFromScriptDataset({ widgetId: "w", openAfter: "10" } as unknown as DOMStringMap),
    );
    expect(cfg.behavior.openAfterSeconds).toBe(10);
  });
});
