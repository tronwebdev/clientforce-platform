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
    await client.uploadData(data, {
      blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
    });
    return path;
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
