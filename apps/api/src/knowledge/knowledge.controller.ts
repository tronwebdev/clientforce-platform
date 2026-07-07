import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createKnowledgeSourceSchema,
  listKnowledgeSourcesQuerySchema,
  retrieveRequestSchema,
  uploadKnowledgeSourceSchema,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import {
  MAX_UPLOAD_BYTES,
  retrieve,
  uploadPathFor,
  type UploadStore,
} from "@clientforce/knowledge";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import {
  INGEST_ENQUEUER,
  KNOWLEDGE_GATEWAY,
  UPLOAD_STORE,
  type IngestEnqueuer,
} from "./knowledge.providers";
import type { AiGateway } from "@clientforce/ai";

/** Extensions the extractor supports (extract.ts dispatch) — reject others at the door. */
const UPLOAD_EXTENSIONS = /\.(pdf|docx|txt|md)$/i;

interface UploadedDocument {
  originalname: string;
  buffer: Buffer;
  size: number;
}

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/**
 * Knowledge sources + retrieval (P1.2). Creation enqueues an ingestion job
 * (PENDING → the worker drives INGESTING → READY/FAILED); the wizard's live
 * status list polls GET /knowledge/sources (A4). CONNECTOR is
 * designed-but-inert (DEC-023) — creation is rejected here.
 */
@Controller("knowledge")
export class KnowledgeController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(INGEST_ENQUEUER) private readonly enqueuer: IngestEnqueuer,
    @Inject(UPLOAD_STORE) private readonly store: UploadStore,
    @Inject(KNOWLEDGE_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  @Post("sources")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async createSource(@Body() body: unknown) {
    const dto = parse(createKnowledgeSourceSchema, body);
    if (dto.kind === "CONNECTOR") {
      throw new BadRequestException(
        "CONNECTOR sources are designed but not yet supported (DEC-023)",
      );
    }
    const workspaceId = this.tenant.workspaceId;
    const source = await this.tenant.run((tx) =>
      tx.knowledgeSource.create({
        data:
          dto.kind === "WEBSITE"
            ? {
                workspaceId,
                agentId: dto.agentId ?? null,
                kind: "WEBSITE",
                uri: dto.uri,
                label: dto.label ?? new URL(dto.uri).hostname,
                meta: {},
              }
            : {
                workspaceId,
                agentId: dto.agentId ?? null,
                kind: "TEXT",
                label: dto.label,
                meta: { text: dto.text },
              },
      }),
    );
    await this.enqueuer.enqueue({ sourceId: source.id, workspaceId });
    return source;
  }

  @Post("sources/upload")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSource(@UploadedFile() file: UploadedDocument | undefined, @Body() body: unknown) {
    if (!file) throw new BadRequestException('Missing multipart "file" field');
    if (!UPLOAD_EXTENSIONS.test(file.originalname)) {
      throw new BadRequestException("Unsupported document type — upload PDF, DOCX, TXT, or MD");
    }
    const dto = parse(uploadKnowledgeSourceSchema, body ?? {});
    const workspaceId = this.tenant.workspaceId;

    const source = await this.tenant.run((tx) =>
      tx.knowledgeSource.create({
        data: {
          workspaceId,
          agentId: dto.agentId ?? null,
          kind: "DOCUMENT",
          label: dto.label ?? file.originalname,
          meta: { filename: file.originalname, bytes: file.size },
        },
      }),
    );
    const path = await this.store.put(
      uploadPathFor(workspaceId, source.id, file.originalname),
      file.buffer,
    );
    const updated = await this.tenant.run((tx) =>
      tx.knowledgeSource.update({ where: { id: source.id }, data: { uri: path } }),
    );
    await this.enqueuer.enqueue({ sourceId: source.id, workspaceId });
    return updated;
  }

  /**
   * DEC-026: the wizard's Upload-doc card must never be a dead click — when
   * document storage isn't configured (no STORAGE_CONNECTION_STRING in a
   * deployed environment) it renders disabled with this reason. Local dev
   * falls back to the filesystem store, so uploads stay enabled there.
   */
  @Get("upload-config")
  uploadConfig() {
    const enabled =
      Boolean(process.env.STORAGE_CONNECTION_STRING) || process.env.NODE_ENV !== "production";
    return {
      enabled,
      reason: enabled
        ? null
        : "Document storage isn't configured yet — the STORAGE-CONNECTION-STRING secret is missing (see the PR #25 owner step).",
    };
  }

  @Get("sources")
  listSources(@Query() query: unknown) {
    const { agentId, scope } = parse(listKnowledgeSourcesQuerySchema, query ?? {});
    return this.tenant.run((tx) =>
      tx.knowledgeSource.findMany({
        where: agentId ? { agentId } : scope === "workspace" ? { agentId: null } : {},
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  @Delete("sources/:id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async deleteSource(@Param("id") id: string) {
    const source = await this.tenant.run((tx) => tx.knowledgeSource.findUnique({ where: { id } }));
    if (!source) throw new NotFoundException();
    if (source.kind === "DOCUMENT" && source.uri) {
      // Best-effort: the row (and its chunks, via cascade) must go even if the
      // blob delete hiccups — an orphaned blob is harmless and re-deletable.
      await this.store.delete(source.uri).catch(() => undefined);
    }
    await this.tenant.run((tx) => tx.knowledgeSource.delete({ where: { id } }));
    return { ok: true };
  }

  @Post("retrieve")
  async retrieveChunks(@Body() body: unknown) {
    const dto = parse(retrieveRequestSchema, body);
    const scope = dto.agentId ? { agentId: dto.agentId } : (dto.scope ?? "all");
    return retrieve(this.prisma.app, this.gateway, this.tenant.workspaceId, dto.query, {
      scope,
      k: dto.k,
    });
  }
}
