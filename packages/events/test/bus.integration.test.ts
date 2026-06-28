/**
 * Integration test (T2/#3 acceptance): emitting `lead.replied.v1` persists an
 * Event and invokes all three consumer stubs.
 *
 * Requires Postgres (Event persistence under RLS) + Redis (BullMQ fan-out).
 * Skips when either is absent so `pnpm test` stays green without infra.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import {
  automationsConsumer,
  dispatcherConsumer,
  emitLeadReplied,
  EventBus,
  redisOptionsFromUrl,
  temporalSignalConsumer,
} from "../src/index";

const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean((process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL) && REDIS_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasInfra)("EventBus integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let bus: EventBus;
  let agencyId: string;
  let workspaceId: string;
  let contactId: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `e-${suffix}`, slug: `e-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const ws = await owner.workspace.create({
      data: { agencyId, name: "E", slug: `e-${suffix}`, settings: {} },
    });
    workspaceId = ws.id;
    const contact = await owner.contact.create({
      data: { workspaceId, source: "manual", optOut: {}, tags: [] },
    });
    contactId = contact.id;

    bus = new EventBus({
      prisma: app,
      connection: redisOptionsFromUrl(REDIS_URL as string),
      queueName: `test.events.${suffix}`,
    });
  });

  afterAll(async () => {
    await bus?.close();
    if (owner && agencyId) {
      await owner.event.deleteMany({ where: { workspaceId } });
      await owner.contact.deleteMany({ where: { workspaceId } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
    vi.restoreAllMocks();
  });

  it(
    "persists lead.replied.v1 and invokes all three consumer stubs",
    async () => {
      const spies = [
        vi.spyOn(temporalSignalConsumer, "handle"),
        vi.spyOn(automationsConsumer, "handle"),
        vi.spyOn(dispatcherConsumer, "handle"),
      ];

      const worker = bus.startConsumer();
      const completed = new Promise<void>((resolve, reject) => {
        worker.on("completed", () => resolve());
        worker.on("failed", (_job, err) => reject(err));
      });

      const event = await emitLeadReplied(bus, { workspaceId, contactId, intent: "interested" });
      expect(event.type).toBe("lead.replied.v1");

      await completed;

      // Persisted to the Event table (owner bypasses RLS for the assertion read).
      const persisted = await owner.event.findUnique({ where: { id: event.id } });
      expect(persisted).not.toBeNull();
      expect(persisted?.type).toBe("lead.replied.v1");
      expect(persisted?.contactId).toBe(contactId);

      // All three consumer stubs invoked exactly once with the event.
      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]).toMatchObject({ id: event.id, type: "lead.replied.v1" });
      }
    },
    30_000,
  );
});
