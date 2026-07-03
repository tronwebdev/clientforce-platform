import type { AiGateway } from "@clientforce/ai";
import { withTenant, type PrismaClient } from "@clientforce/db";

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  content: string;
  /** Cosine similarity in [0,1] (1 = identical direction). */
  score: number;
}

export interface RetrieveOptions {
  /**
   * Restrict to one agent's sources (+ workspace-level unless
   * `includeWorkspace: false` — the P1.3 agent-layer distiller needs
   * agent-only evidence), workspace-level sources, or (default) all.
   */
  scope?: { agentId: string; includeWorkspace?: boolean } | "workspace" | "all";
  k?: number;
}

/**
 * Top-k cosine retrieval over the hnsw index, always through the RLS-subject
 * client — a workspace can only ever see its own chunks (round-trip tested).
 * Scope filters support P1.3's two-layer gap checker (workspace vs agent).
 */
export async function retrieve(
  prisma: PrismaClient,
  gateway: AiGateway,
  workspaceId: string,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const k = options.k ?? 8;
  const [queryVector] = await gateway.embed([query]);
  const vector = `[${queryVector!.join(",")}]`;

  return withTenant(prisma, { workspaceId }, async (tx) => {
    const scope = options.scope ?? "all";
    const rows = await (scope === "all"
      ? tx.$queryRaw`
          SELECT c."id", c."sourceId", c."content", 1 - (c."embedding" <=> ${vector}::vector) AS score
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
          WHERE s."status" = 'READY'
          ORDER BY c."embedding" <=> ${vector}::vector
          LIMIT ${k}`
      : scope === "workspace"
        ? tx.$queryRaw`
          SELECT c."id", c."sourceId", c."content", 1 - (c."embedding" <=> ${vector}::vector) AS score
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
          WHERE s."status" = 'READY' AND s."agentId" IS NULL
          ORDER BY c."embedding" <=> ${vector}::vector
          LIMIT ${k}`
        : scope.includeWorkspace === false
          ? tx.$queryRaw`
          SELECT c."id", c."sourceId", c."content", 1 - (c."embedding" <=> ${vector}::vector) AS score
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
          WHERE s."status" = 'READY' AND s."agentId" = ${scope.agentId}
          ORDER BY c."embedding" <=> ${vector}::vector
          LIMIT ${k}`
          : tx.$queryRaw`
          SELECT c."id", c."sourceId", c."content", 1 - (c."embedding" <=> ${vector}::vector) AS score
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
          WHERE s."status" = 'READY' AND (s."agentId" = ${scope.agentId} OR s."agentId" IS NULL)
          ORDER BY c."embedding" <=> ${vector}::vector
          LIMIT ${k}`);
    return (rows as Array<RetrievedChunk & { score: unknown }>).map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      content: r.content,
      score: Number(r.score),
    }));
  });
}
