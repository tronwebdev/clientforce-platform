import { randomUUID } from "node:crypto";
import type { AiGateway } from "@clientforce/ai";
import { withTenant, type KnowledgeSource, type PrismaClient } from "@clientforce/db";
import { chunkText } from "./chunk";
import { ExtractionError, extractFromDocument, extractFromUrl } from "./extract";
import type { UploadStore } from "./storage";

export interface IngestDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  gateway: AiGateway;
  store: UploadStore;
  fetchImpl?: typeof fetch;
}

export interface IngestJobPayload {
  sourceId: string;
  workspaceId: string;
}

const EMBED_BATCH = 64;

/**
 * The ingestion pipeline (P1.2): PENDING → INGESTING → extract → chunk →
 * embed (1536, via @clientforce/ai) → store chunks → READY; any failure →
 * FAILED with `meta.error`. Re-ingest is idempotent: prior chunks are
 * replaced. All DB access is tenant-scoped through `withTenant`.
 */
export async function ingestSource(deps: IngestDeps, job: IngestJobPayload): Promise<void> {
  const { prisma, gateway } = deps;
  const ctx = { workspaceId: job.workspaceId };

  const source = await withTenant(prisma, ctx, (tx) =>
    tx.knowledgeSource.findUnique({ where: { id: job.sourceId } }),
  );
  if (!source)
    throw new Error(`KnowledgeSource ${job.sourceId} not found in workspace ${job.workspaceId}`);

  await setStatus(deps, job, "INGESTING");
  try {
    const { text, title } = await extract(source, deps);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new ExtractionError("Extraction produced no chunkable text");

    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      vectors.push(
        ...(await gateway.embed(chunks.slice(i, i + EMBED_BATCH).map((c) => c.content))),
      );
    }

    await withTenant(prisma, ctx, async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const vector = `[${vectors[i]!.join(",")}]`;
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk" ("id", "workspaceId", "sourceId", "content", "embedding", "tokens", "updatedAt")
          VALUES (${randomUUID()}, ${job.workspaceId}, ${source.id}, ${chunk.content}, ${vector}::vector, ${chunk.tokens}, NOW())`;
      }
      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: {
          status: "READY",
          meta: {
            ...asObject(source.meta),
            chunkCount: chunks.length,
            ...(title ? { title } : {}),
            error: null,
          },
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withTenant(prisma, ctx, (tx) =>
      tx.knowledgeSource.update({
        where: { id: source.id },
        data: { status: "FAILED", meta: { ...asObject(source.meta), error: message } },
      }),
    );
    // Extraction errors are terminal (bad input) — swallow after recording.
    // Anything else (DB/embedding infra) rethrows so BullMQ can retry.
    if (!(err instanceof ExtractionError)) throw err;
  }
}

async function extract(
  source: KnowledgeSource,
  deps: IngestDeps,
): Promise<{ text: string; title: string | null }> {
  switch (source.kind) {
    case "WEBSITE": {
      if (!source.uri) throw new ExtractionError("WEBSITE source has no uri");
      return extractFromUrl(source.uri, deps.fetchImpl);
    }
    case "DOCUMENT": {
      if (!source.uri) throw new ExtractionError("DOCUMENT source has no uri (blob path)");
      const data = await deps.store.get(source.uri);
      return { text: await extractFromDocument(source.label, data), title: null };
    }
    case "TEXT": {
      const text = asObject(source.meta).text;
      if (typeof text !== "string" || !text.trim())
        throw new ExtractionError("TEXT source has no meta.text");
      return { text, title: null };
    }
    case "CONNECTOR":
      // Designed-but-inert (DEC-023) — the API rejects creation; the worker is defensive.
      throw new ExtractionError("CONNECTOR sources are not yet supported");
    default:
      throw new ExtractionError(`Unknown source kind: ${String(source.kind)}`);
  }
}

async function setStatus(
  deps: IngestDeps,
  job: IngestJobPayload,
  status: "INGESTING",
): Promise<void> {
  await withTenant(deps.prisma, { workspaceId: job.workspaceId }, (tx) =>
    tx.knowledgeSource.update({ where: { id: job.sourceId }, data: { status } }),
  );
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
