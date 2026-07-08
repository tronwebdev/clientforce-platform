import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";

/**
 * Upload storage seam for DOCUMENT sources. Production = Azure Blob (the
 * Phase-0 `uploads` container on `clientforcedevstorage`, connection string
 * from Key Vault secret STORAGE-CONNECTION-STRING); tests/local dev use the
 * filesystem or memory fakes — CI never touches Azure.
 */
export interface UploadStore {
  /** Stores the file and returns the storage path recorded on `KnowledgeSource.uri`. */
  put(path: string, data: Buffer, contentType?: string): Promise<string>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
}

export const uploadPathFor = (workspaceId: string, sourceId: string, filename: string): string =>
  `workspaces/${workspaceId}/knowledge/${sourceId}/${filename}`;

/**
 * Blob writes are bounded so a closed network path fails in seconds with a
 * designed error instead of hanging the upload request into the Container
 * Apps 240s ingress timeout (the 2026-07-08 staging outage symptom). The API
 * maps `StorageUnavailableError` to a 503 naming storage as the prerequisite.
 */
export const STORAGE_OP_TIMEOUT_MS = 15_000;

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      `Document storage did not respond within ${STORAGE_OP_TIMEOUT_MS / 1000}s` +
        (cause instanceof Error ? ` (${cause.message})` : ""),
    );
    this.name = "StorageUnavailableError";
  }
}

export class AzureBlobUploadStore implements UploadStore {
  private readonly service: BlobServiceClient;

  constructor(
    connectionString = process.env.STORAGE_CONNECTION_STRING,
    private readonly container = process.env.STORAGE_UPLOADS_CONTAINER ?? "uploads",
  ) {
    if (!connectionString) {
      throw new Error(
        "STORAGE_CONNECTION_STRING is not set. In deployed environments it resolves from Key Vault secret STORAGE-CONNECTION-STRING (see PR #25 owner step).",
      );
    }
    this.service = BlobServiceClient.fromConnectionString(connectionString);
  }

  async put(path: string, data: Buffer, contentType?: string): Promise<string> {
    const client = this.service.getContainerClient(this.container).getBlockBlobClient(path);
    try {
      await client.uploadData(data, {
        abortSignal: AbortSignal.timeout(STORAGE_OP_TIMEOUT_MS),
        blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new StorageUnavailableError(err);
      }
      throw err;
    }
    return path;
  }

  /** /system/health probe — one bounded round-trip to the uploads container. */
  async reachable(): Promise<boolean> {
    try {
      await this.service
        .getContainerClient(this.container)
        .exists({ abortSignal: AbortSignal.timeout(3_000) });
      return true;
    } catch {
      return false;
    }
  }

  async get(path: string): Promise<Buffer> {
    const client = this.service.getContainerClient(this.container).getBlockBlobClient(path);
    return client.downloadToBuffer();
  }

  async delete(path: string): Promise<void> {
    const client = this.service.getContainerClient(this.container).getBlockBlobClient(path);
    await client.deleteIfExists();
  }
}

/**
 * Environment factory used by the api + worker processes: Azure Blob when
 * STORAGE_CONNECTION_STRING is present (staging/production), otherwise a
 * filesystem store rooted at UPLOADS_DIR (local dev; api and worker must share
 * it — the default resolves per-process cwd, so set UPLOADS_DIR explicitly
 * when running both).
 */
export function createUploadStoreFromEnv(): UploadStore {
  if (process.env.STORAGE_CONNECTION_STRING) return new AzureBlobUploadStore();
  return new FileUploadStore(process.env.UPLOADS_DIR ?? join(process.cwd(), ".uploads"));
}

/** Filesystem-backed store — local dev + integration tests. */
export class FileUploadStore implements UploadStore {
  constructor(private readonly root: string) {}

  async put(path: string, data: Buffer): Promise<string> {
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return path;
  }

  async get(path: string): Promise<Buffer> {
    return readFile(join(this.root, path));
  }

  async delete(path: string): Promise<void> {
    await rm(join(this.root, path), { force: true });
  }
}

/** In-memory store — unit tests. */
export class MemoryUploadStore implements UploadStore {
  private readonly files = new Map<string, Buffer>();

  async put(path: string, data: Buffer): Promise<string> {
    this.files.set(path, data);
    return path;
  }

  async get(path: string): Promise<Buffer> {
    const f = this.files.get(path);
    if (!f) throw new Error(`Not found: ${path}`);
    return f;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}
