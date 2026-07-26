/**
 * The drop-in contract: canonical script-tag auto-init and the pre-load
 * command queue. Each test imports the entry fresh (module side effect =
 * bootstrap on load, exactly like the IIFE bundle).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueueFn = ((...args: unknown[]) => void) & { q?: unknown[][]; instance?: () => unknown };

function getGlobal(): QueueFn | undefined {
  return (window as unknown as Record<string, unknown>).ClientforceWidget as QueueFn | undefined;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  getGlobal()?.("destroy");
  delete (window as unknown as Record<string, unknown>).ClientforceWidget;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("canonical snippet auto-init", () => {
  it("a script tag with data-widget-id mounts the widget on load", async () => {
    const tag = document.createElement("script");
    tag.setAttribute("data-widget-id", "wgt_8fa3c21e");
    tag.setAttribute("data-launcher-text", "Chat with Acme");
    document.body.appendChild(tag);

    await import("../src/index");

    const host = document.getElementById("clientforce-widget-host");
    expect(host).toBeTruthy();
    expect(host!.getAttribute("data-clientforce-widget")).toBe("wgt_8fa3c21e");
    expect(host!.shadowRoot!.querySelector(".cfw-label")!.textContent).toBe("Chat with Acme");
    expect(getGlobal()!.version).toBeTruthy();
  });

  it("no tag, no queue → defines the global but mounts nothing", async () => {
    await import("../src/index");
    expect(getGlobal()).toBeTypeOf("function");
    expect(document.getElementById("clientforce-widget-host")).toBeNull();
  });
});

describe("pre-load command queue", () => {
  it("queued init (+ trailing commands) replays in order on load; queued init wins over the tag", async () => {
    const stub: QueueFn = (...args: unknown[]) => {
      (stub.q = stub.q ?? []).push(args);
    };
    (window as unknown as Record<string, unknown>).ClientforceWidget = stub;
    stub("init", { widgetId: "wgt_queue", behavior: { openAfterSeconds: null } });
    stub("open");

    const tag = document.createElement("script");
    tag.setAttribute("data-widget-id", "wgt_tag_should_lose");
    document.body.appendChild(tag);

    await import("../src/index");

    const host = document.getElementById("clientforce-widget-host");
    expect(host!.getAttribute("data-clientforce-widget")).toBe("wgt_queue");
    expect(host!.shadowRoot!.querySelector(".cfw-root")!.getAttribute("data-state")).toBe("open");
    expect(document.querySelectorAll("#clientforce-widget-host")).toHaveLength(1);
  });

  it("pre-init listener commands queue until the tag init runs, then attach", async () => {
    const stub: QueueFn = (...args: unknown[]) => {
      (stub.q = stub.q ?? []).push(args);
    };
    (window as unknown as Record<string, unknown>).ClientforceWidget = stub;
    const seen: unknown[] = [];
    stub("on", "ready", (p: unknown) => seen.push(p));

    const tag = document.createElement("script");
    tag.setAttribute("data-widget-id", "wgt_tag");
    document.body.appendChild(tag);

    await import("../src/index");
    await new Promise((r) => setTimeout(r, 650)); // default stub think-delay

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ stub: true });
  });

  it("repeat init warns and keeps the first instance", async () => {
    await import("../src/index");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = getGlobal()!;
    g("init", { widgetId: "wgt_one", behavior: { openAfterSeconds: null } });
    g("init", { widgetId: "wgt_two", behavior: { openAfterSeconds: null } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already initialized"));
    expect(
      document.getElementById("clientforce-widget-host")!.getAttribute("data-clientforce-widget"),
    ).toBe("wgt_one");
  });

  it("destroy releases the page for a clean re-init", async () => {
    await import("../src/index");
    const g = getGlobal()!;
    g("init", { widgetId: "wgt_a", behavior: { openAfterSeconds: null } });
    g("destroy");
    expect(document.getElementById("clientforce-widget-host")).toBeNull();
    g("init", { widgetId: "wgt_b", behavior: { openAfterSeconds: null } });
    expect(
      document.getElementById("clientforce-widget-host")!.getAttribute("data-clientforce-widget"),
    ).toBe("wgt_b");
  });
});
