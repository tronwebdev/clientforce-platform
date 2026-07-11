/**
 * P1.7: the real temporal-signal consumer — signals on `*.replied.v1` with an
 * enrollment + intent, ignores everything else, and never lets a signal
 * failure dead-letter the event.
 */
import { describe, expect, it, vi } from "vitest";
import { createTemporalSignalConsumer } from "../src/consumers";
import type { BusEvent } from "../src/types";

const event = (over: Partial<BusEvent>): BusEvent =>
  ({
    id: "evt-1",
    workspaceId: "ws-1",
    type: "email.replied.v1",
    contactId: "c-1",
    enrollmentId: "enr-1",
    campaignId: "cmp-1",
    payload: { messageId: "m-1", intent: "interested" },
    occurredAt: new Date().toISOString(),
    ...over,
  }) as BusEvent;

describe("createTemporalSignalConsumer", () => {
  it("signals the enrollment with the classified intent on *.replied.v1", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    await createTemporalSignalConsumer(signal).handle(event({}));
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith("enr-1", "interested");
  });

  it("ignores non-reply events, missing enrollments, and missing intents", async () => {
    const signal = vi.fn();
    const consumer = createTemporalSignalConsumer(signal);
    await consumer.handle(event({ type: "email.opened.v1", payload: { messageId: "m-1" } }));
    await consumer.handle(event({ enrollmentId: null as unknown as string }));
    await consumer.handle(event({ payload: { messageId: "m-1" } }));
    expect(signal).not.toHaveBeenCalled();
  });

  it("logs (not throws) when signalling fails — the Event row is already persisted", async () => {
    const log = vi.fn();
    const consumer = createTemporalSignalConsumer(
      vi.fn().mockRejectedValue(new Error("workflow not found")),
      log,
    );
    await expect(consumer.handle(event({}))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("enr-1"));
  });

  // R1 (DEC-074): the campaign-rules gate — rails → rules → graph continuation.
  it("skips the signal when the rules gate answers false — a terminal rule action handled the reply", async () => {
    const signal = vi.fn();
    const log = vi.fn();
    const consumer = createTemporalSignalConsumer(signal, log, async () => false);
    await consumer.handle(event({}));
    expect(signal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gated"));
  });

  it("signals normally when the gate answers true", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const consumer = createTemporalSignalConsumer(signal, vi.fn(), async () => true);
    await consumer.handle(event({}));
    expect(signal).toHaveBeenCalledWith("enr-1", "interested");
  });

  it("fails OPEN when the gate itself throws — a rules bug must not break reply handling", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const consumer = createTemporalSignalConsumer(signal, log, async () => {
      throw new Error("rules engine down");
    });
    await consumer.handle(event({}));
    expect(signal).toHaveBeenCalledWith("enr-1", "interested");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failing OPEN"));
  });
});
