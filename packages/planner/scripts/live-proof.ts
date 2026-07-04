/**
 * P1.4 live verification (§G + DEC-015): ingest https://clientforce.io,
 * distill the workspace layer, then PLAN with real Opus-class completions and
 * print the sequence. Gates on ≥2 concrete facts in the step copy that trace
 * to the distilled (chunk-cited) BusinessContext values. Runs in the
 * planner-live-proof GitHub workflow; never in CI tests.
 */
import { AiGateway, AnthropicProvider, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import { distill, parseFields } from "@clientforce/context";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { ingestSource, MemoryUploadStore } from "@clientforce/knowledge";
import type { StepNode } from "@clientforce/core";
import { planCampaign } from "../src/plan";

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

  const suffix = `plan-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  try {
    console.log(`\n=== P1.4 LIVE PROOF · ingest → distill → plan (${TARGET}) ===`);
    const src = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.knowledgeSource.create({
        data: { workspaceId: ws.id, kind: "WEBSITE", uri: TARGET, label: TARGET, meta: {} },
      }),
    );
    await ingestSource(
      { prisma: app, gateway, store: new MemoryUploadStore() },
      { sourceId: src.id, workspaceId: ws.id },
    );
    const ctxRow = await distill({ prisma: app, gateway }, { workspaceId: ws.id });
    const fields = parseFields(ctxRow.fields);
    console.log(`distilled: ${Object.keys(fields).length} cited fields`);

    const agent = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.agent.create({
        data: {
          workspaceId: ws.id,
          name: "Demo Booker",
          goal: "book_appointments",
          guardrails: {},
        },
      }),
    );
    const result = await planCampaign(
      { prisma: app, gateway },
      { workspaceId: ws.id, agentId: agent.id },
    );

    console.log(
      `\n--- planned CampaignGraph v${result.graphRow.version} (source=${result.graphRow.source}) ---`,
    );
    const steps = result.graph.nodes.filter((n): n is StepNode => n.type === "step");
    for (const node of result.graph.nodes) {
      if (node.type === "step") {
        console.log(`\n[${node.id}] EMAIL — subject: ${node.content.subject}`);
        console.log(node.content.body);
      } else if (node.type === "delay") {
        console.log(`\n[${node.id}] WAIT ${node.amount} ${node.unit}`);
      } else if (node.type === "branch") {
        console.log(
          `\n[${node.id}] BRANCH on ${node.on}: ${node.cases
            .map((c) => `${c.when === "default" ? "default" : c.when.intent}→${c.goto}`)
            .join(" · ")}`,
        );
      }
    }
    console.log(`\ndry-run actions: ${result.dryRun.map((a) => a.kind).join(" → ")}`);

    // §G / DEC-015 gate: ≥2 concrete facts in copy traceable to distilled
    // (chunk-cited) context values — 5+-char fragments shared verbatim.
    const copy = steps
      .map((s) => `${s.content.subject ?? ""} ${s.content.body ?? ""}`)
      .join(" ")
      .toLowerCase();
    const traced: string[] = [];
    for (const [key, entry] of Object.entries(fields)) {
      if (entry.citations.length === 0) continue;
      const fragments = entry.value
        .toLowerCase()
        .split(/[^a-z0-9$%+.-]+/)
        .filter((w) => w.length >= 5);
      const hits = fragments.filter((f) => copy.includes(f));
      if (hits.length >= 2) traced.push(`${key} (via "${hits.slice(0, 3).join('", "')}")`);
    }
    console.log(`\ntraceable context fields referenced in copy: ${traced.length}`);
    for (const t of traced) console.log(`  ✓ ${t}`);
    if (traced.length < 2) {
      throw new Error(
        `Proof failed the §G/DEC-015 gate: only ${traced.length} context fields traceable in copy (need ≥2)`,
      );
    }
    console.log("\n§G gate passed.");
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
