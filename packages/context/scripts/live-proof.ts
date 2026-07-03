/**
 * P1.3 live verification (§G): ingest https://clientforce.io with real
 * embeddings, distill the WORKSPACE layer with real completions, then print
 * the distilled context — every field with its chunk citations and the cited
 * chunks' excerpts, so ≥2 concrete facts are traceable to the ingested pages.
 * Runs in the context-live-proof GitHub workflow (egress + Key Vault keys);
 * never in CI tests.
 */
import { AiGateway, AnthropicProvider, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { ingestSource, MemoryUploadStore } from "@clientforce/knowledge";
import { distill, parseFields } from "../src/distill";
import { checkGaps } from "../src/gaps";

const TARGET = process.env.LIVE_PROOF_URL ?? "https://clientforce.io";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({
    provider: new AnthropicProvider(),
    embeddings: new OpenAiEmbeddingsProvider(),
  });

  const suffix = `ctx-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  try {
    console.log(`\n=== P1.3 LIVE PROOF · distill from ${TARGET} ===`);
    const src = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeSource.create({
        data: { workspaceId: ws.id, kind: "WEBSITE", uri: TARGET, label: TARGET, meta: {} },
      }),
    );
    await ingestSource(
      { prisma: app, gateway, store: new MemoryUploadStore() },
      { sourceId: src.id, workspaceId: ws.id },
    );
    const after = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    if (after.status !== "READY") {
      throw new Error(`Ingestion did not reach READY: ${JSON.stringify(after.meta)}`);
    }
    console.log(
      `ingested: status=READY chunks=${(after.meta as { chunkCount?: number }).chunkCount}`,
    );

    const row = await distill({ prisma: app, gateway }, { workspaceId: ws.id });
    const fields = parseFields(row.fields);
    const chunks = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeChunk.findMany({ where: { workspaceId: ws.id } }),
    );
    const chunkById = new Map(chunks.map((c) => [c.id, c.content]));

    console.log(`\n--- distilled WORKSPACE layer (status=${row.status}) ---`);
    console.log(`rawSummary: ${row.rawSummary}`);
    for (const [key, entry] of Object.entries(fields)) {
      console.log(`\n[${key}] (${entry.source}) ${entry.value}`);
      for (const id of entry.citations) {
        console.log(
          `  ↳ cites chunk ${id}: "${(chunkById.get(id) ?? "<missing>").slice(0, 220).replace(/\n/g, " | ")}"`,
        );
      }
    }

    const report = checkGaps({
      goal: "book_appointments",
      workspaceFields: fields,
      agentFields: {},
    });
    console.log(`\n--- gap report (goal=book_appointments, workspace layer only) ---`);
    for (const g of report.gaps) {
      console.log(
        `  ${g.status === "open" ? "◻ GAP " : "✓ " + g.status} ${g.key}${g.coveredBy ? ` (found in your docs — ${g.coveredBy} layer)` : ""}`,
      );
    }
    console.log(`resolved ${report.resolved}/${report.total} · launchReady=${report.launchReady}`);

    // §G gate: the proof FAILS unless the distilled context carries at least
    // two cited fields traceable to the ingested pages — a green run must
    // mean a real, evidence-grounded distillation.
    const cited = Object.entries(fields).filter(
      ([, e]) => e.source === "distilled" && e.citations.length > 0,
    );
    if (cited.length < 2 || !row.rawSummary.trim()) {
      throw new Error(
        `Proof failed the §G gate: ${cited.length} cited fields (need ≥2), rawSummary ${row.rawSummary.trim() ? "present" : "EMPTY"}`,
      );
    }
    console.log(`\n§G gate passed: ${cited.length} evidence-cited fields distilled.`);
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
