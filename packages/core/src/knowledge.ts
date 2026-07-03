/**
 * Knowledge DTOs (P1.2) — the REST contract between apps/web and the NestJS
 * knowledge module (A2: zod-typed DTOs live here, one typed client consumes
 * them). Source kinds per DEC-023: WEBSITE · DOCUMENT (multipart upload, not
 * in the JSON create schema) · TEXT live; CONNECTOR designed-but-inert — the
 * schema carries it so the contract is complete, but the API rejects it.
 */
import { z } from "zod";

export const knowledgeSourceKindSchema = z.enum(["WEBSITE", "DOCUMENT", "TEXT", "CONNECTOR"]);
export type KnowledgeSourceKind = z.infer<typeof knowledgeSourceKindSchema>;

export const ingestStatusSchema = z.enum(["PENDING", "INGESTING", "READY", "FAILED"]);
export type IngestStatus = z.infer<typeof ingestStatusSchema>;

/** JSON create payloads. DOCUMENT goes through POST /knowledge/sources/upload (multipart). */
export const createKnowledgeSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("WEBSITE"),
    uri: z.string().url().max(2_048),
    label: z.string().min(1).max(200).optional(),
    agentId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("TEXT"),
    text: z.string().min(1).max(500_000),
    label: z.string().min(1).max(200),
    agentId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("CONNECTOR"),
    provider: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    agentId: z.string().min(1).optional(),
  }),
]);
export type CreateKnowledgeSourceDto = z.infer<typeof createKnowledgeSourceSchema>;

/** Multipart fields accompanying the DOCUMENT upload (`file` carries the bytes). */
export const uploadKnowledgeSourceSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  agentId: z.string().min(1).optional(),
});
export type UploadKnowledgeSourceDto = z.infer<typeof uploadKnowledgeSourceSchema>;

export const knowledgeSourceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentId: z.string().nullable(),
  kind: knowledgeSourceKindSchema,
  uri: z.string().nullable(),
  label: z.string(),
  status: ingestStatusSchema,
  meta: z
    .object({
      chunkCount: z.number().int().optional(),
      title: z.string().nullable().optional(),
      error: z.string().nullable().optional(),
    })
    .passthrough(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeSourceDto = z.infer<typeof knowledgeSourceSchema>;

export const listKnowledgeSourcesQuerySchema = z.object({
  /** Filter to one agent's sources; omit for every source in the workspace. */
  agentId: z.string().min(1).optional(),
  /** `workspace` = workspace-scoped only (agentId IS NULL) — the Brand-kit list. */
  scope: z.enum(["all", "workspace"]).optional(),
});
export type ListKnowledgeSourcesQuery = z.infer<typeof listKnowledgeSourcesQuerySchema>;

export const retrieveRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  k: z.number().int().min(1).max(50).optional(),
  /** Agent scope (agent + workspace layers, DEC-025); wins over `scope`. */
  agentId: z.string().min(1).optional(),
  scope: z.enum(["all", "workspace"]).optional(),
});
export type RetrieveRequestDto = z.infer<typeof retrieveRequestSchema>;

export const retrievedChunkSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  content: z.string(),
  /** Cosine similarity in [0,1]. */
  score: z.number(),
});
export type RetrievedChunkDto = z.infer<typeof retrievedChunkSchema>;
