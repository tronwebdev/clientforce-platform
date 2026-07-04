import type { AiGateway } from "@clientforce/ai";
import { withTenant, type PrismaClient } from "@clientforce/db";

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  content: string;
  /** Cosine similarity in [0,1] (1 = identical direction). */
  score: number;
  // Source snapshot fields (DEC-028) — citation rendering needs label/type/
  // locator without a second query; joined from KnowledgeSource.
  sourceLabel: string;
  sourceType: "WEBSITE" | "DOCUMENT" | "CONNECTOR" | "TEXT";
  sourceUri: string | null;
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

const SELECT = `
  SELECT c."id", c."sourceId", c."content",
         1 - (c."embedding" <=> $1::vector) AS score,
         s."label" AS "sourceLabel", s."kind"::text AS "sourceType", s."uri" AS "sourceUri"
  FROM "KnowledgeChunk" c
  JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
  WHERE s."status" = 'READY'`;

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
  // Clamped + floored — k is interpolated into the LIMIT clause.
  const k = Math.max(1, Math.min(100, Math.floor(options.k ?? 8)));
  const [queryVector] = await gateway.embed([query]);
  const vector = `[${queryVector!.join(",")}]`;

  const scope = options.scope ?? "all";
  const { filter, params } =
    scope === "all"
      ? { filter: "", params: [] as string[] }
      : scope === "workspace"
        ? { filter: ` AND s."agentId" IS NULL`, params: [] as string[] }
        : scope.includeWorkspace === false
          ? { filter: ` AND s."agentId" = $2`, params: [scope.agentId] }
          : { filter: ` AND (s."agentId" = $2 OR s."agentId" IS NULL)`, params: [scope.agentId] };
  const sql = `${SELECT}${filter}
  ORDER BY c."embedding" <=> $1::vector
  LIMIT ${k}`;

  return withTenant(prisma, { workspaceId }, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<RetrievedChunk & { score: unknown }>>(
      sql,
      vector,
      ...params,
    );
    return rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      content: r.content,
      score: Number(r.score),
      sourceLabel: r.sourceLabel,
      sourceType: r.sourceType,
      sourceUri: r.sourceUri,
    }));
  });
}
