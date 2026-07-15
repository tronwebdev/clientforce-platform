/**
 * B1 W3 (DEC-081) — the privacy rail is a PINNED TEST, not a convention.
 *
 * (1) No telemetry payload schema may declare a PII/body key.
 * (2) Every telemetry type is versioned (`.vN`).
 * (3) Runtime stripping: an accidental PII field is dropped by validation.
 * (4) The bus consumer maps domain sends/replies → PII-free telemetry.
 */
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { BusEvent } from "@clientforce/events";
import {
  PII_DENYLIST,
  TELEMETRY_SCHEMAS,
  TELEMETRY_TYPES,
  validateTelemetry,
  createTelemetryConsumer,
  createRecorder,
  mapDomainEvent,
  NoopSink,
  type TelemetryRecord,
} from "../src/index";

const denylist = new Set(PII_DENYLIST.map((k) => k.toLowerCase()));

describe("privacy rail", () => {
  it("no telemetry schema declares a PII/body key", () => {
    for (const [name, schema] of Object.entries(TELEMETRY_SCHEMAS)) {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const key of Object.keys(shape)) {
        expect(denylist.has(key.toLowerCase()), `${name}.${key} is a PII/body key`).toBe(false);
      }
    }
  });

  it("every telemetry type is versioned (noun.verb.vN)", () => {
    for (const t of TELEMETRY_TYPES) {
      expect(t, `${t} must be versioned`).toMatch(/\.v\d+$/);
    }
  });

  it("runtime validation STRIPS an accidental PII field", () => {
    // Even if a caller sneaks in `email`, the schema doesn't declare it → dropped.
    const cleaned = validateTelemetry("product.send.v1", {
      workspaceId: "ws1",
      channel: "email",
      email: "leak@example.com",
      body: "secret message body",
    } as unknown);
    expect(cleaned).toEqual({ workspaceId: "ws1", channel: "email" });
    expect("email" in (cleaned as object)).toBe(false);
    expect("body" in (cleaned as object)).toBe(false);
  });
});

describe("bus consumer", () => {
  const ev = (type: string): BusEvent => ({
    id: "e1",
    workspaceId: "ws1",
    type: type as BusEvent["type"],
    contactId: "c1",
    enrollmentId: null,
    campaignId: null,
    payload: { some: "domain payload" },
    occurredAt: "2026-07-15T00:00:00.000Z",
  });

  it("maps sends and replies to PII-free telemetry, ignores the rest", () => {
    expect(mapDomainEvent(ev("email.sent.v1"))?.name).toBe("product.send.v1");
    expect(mapDomainEvent(ev("sms.replied.v1"))?.name).toBe("product.reply.v1");
    expect(mapDomainEvent(ev("email.opened.v1"))).toBeNull();
    // the mapped props carry only ids + the channel label — never the domain payload
    expect(mapDomainEvent(ev("email.sent.v1"))?.props).toEqual({ workspaceId: "ws1", channel: "email" });
  });

  it("records the mapped telemetry through the injected recorder", async () => {
    const captured: TelemetryRecord[] = [];
    const consumer = createTelemetryConsumer({ record: async (r) => void captured.push(r) });
    await consumer.handle(ev("email.sent.v1"));
    await consumer.handle(ev("email.opened.v1")); // ignored
    expect(captured).toHaveLength(1);
    expect(captured[0]!.name).toBe("product.send.v1");
    expect(captured[0]!.props).toEqual({ workspaceId: "ws1", channel: "email" });
  });
});

describe("recorder", () => {
  it("persists to the store and forwards to the sink", async () => {
    const saved: TelemetryRecord[] = [];
    const sink = { capture: vi.fn() };
    const record = createRecorder(sink, { save: async (r) => void saved.push(r) });
    const rec: TelemetryRecord = {
      name: "product.agent_launched.v1",
      actorType: "operator",
      workspaceId: "ws1",
      props: { workspaceId: "ws1", agentId: "a1", actorId: "op1" },
      occurredAt: "2026-07-15T00:00:00.000Z",
    };
    await record(rec);
    expect(saved).toHaveLength(1);
    expect(sink.capture).toHaveBeenCalledOnce();
  });

  it("NoopSink captures nothing but does not throw", async () => {
    const record = createRecorder(NoopSink);
    await expect(
      record({
        name: "product.reply.v1",
        actorType: "system",
        workspaceId: "ws1",
        props: { workspaceId: "ws1", channel: "email" },
        occurredAt: "2026-07-15T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
