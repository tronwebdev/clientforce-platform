/**
 * P1.2 live verification (§G ingestion-proof rule): ingest https://clientforce.io
 * with REAL fetch + REAL OpenAI embeddings, then retrieve and print a report
 * showing READY status, chunk counts, and concrete facts traceable to the
 * ingested pages. Runs in the knowledge-live-proof GitHub workflow (the only
 * environment with both egress and the Key Vault key); never in CI tests.
 */
import { AiGateway, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { ingestSource } from "../src/pipeline";
import { retrieve } from "../src/retrieve";
import { MemoryUploadStore } from "../src/storage";

const TARGET = process.env.LIVE_PROOF_URL ?? "https://clientforce.io";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({
    provider: {
      completeText: async () => {
        throw new Error("not used");
      },
      completeTool: async () => {
        throw new Error("not used");
      },
    },
    embeddings: new OpenAiEmbeddingsProvider(),
  });

  const suffix = `proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  try {
    const src = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeSource.create({
        data: { workspaceId: ws.id, kind: "WEBSITE", uri: TARGET, label: TARGET, meta: {} },
      }),
    );
    console.log(`\n=== P1.2 LIVE PROOF · ${TARGET} ===`);
    console.log(`source ${src.id} status=${src.status}`);

    await ingestSource(
      { prisma: app, gateway, store: new MemoryUploadStore() },
      {
        sourceId: src.id,
        workspaceId: ws.id,
      },
    );

    const after = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    const meta = after.meta as { chunkCount?: number; title?: string; error?: string };
    console.log(
      `status=${after.status} title=${JSON.stringify(meta.title ?? null)} chunks=${meta.chunkCount ?? 0}`,
    );
    if (after.status !== "READY") throw new Error(`Ingestion did not reach READY: ${meta.error}`);

    for (const query of [
      "What does Clientforce do?",
      "What channels and outcomes does the product offer?",
    ]) {
      const hits = await retrieve(app, gateway, ws.id, query, { k: 3 });
      console.log(`\n--- retrieve(${JSON.stringify(query)}) → ${hits.length} chunks ---`);
      for (const h of hits) {
        console.log(`[chunk ${h.id} · score ${h.score.toFixed(3)}]`);
        console.log(h.content.slice(0, 400).replace(/\n/g, " | "));
      }
    }
    console.log("\n=== END LIVE PROOF ===");
  } finally {
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
