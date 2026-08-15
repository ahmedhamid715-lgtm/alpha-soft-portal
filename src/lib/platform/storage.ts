import "server-only";

/**
 * File storage abstraction (spec section 22). No implementation ships in
 * Module 01 — the point is that business modules (Documents, Proposals,
 * Creative Services, ...) code against `StorageProvider`, not against a
 * specific vendor SDK, so swapping local-disk dev storage for S3-compatible
 * or Vercel Blob in production is a provider swap, not a rewrite.
 */
export interface UploadOptions {
  contentType?: string;
  /** Bytes, if known up front — lets providers reject oversized uploads early. */
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  lastModified: Date;
}

export interface StorageProvider {
  upload(key: string, data: Buffer | Uint8Array | ReadableStream, options?: UploadOptions): Promise<StorageObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A time-limited URL a client can fetch directly, bypassing the app server. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/**
 * Thrown by any StorageProvider member until Module 56 (File & Storage
 * Infrastructure) picks and wires a real provider. Failing loudly here
 * beats silently no-opping a file upload.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "No StorageProvider is configured yet. This lands in Module 56 (File & Storage Infrastructure) — see docs/architecture/platform-core.md.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

class UnconfiguredStorageProvider implements StorageProvider {
  async upload(): Promise<StorageObject> {
    throw new StorageNotConfiguredError();
  }
  async download(): Promise<Buffer> {
    throw new StorageNotConfiguredError();
  }
  async delete(): Promise<void> {
    throw new StorageNotConfiguredError();
  }
  async exists(): Promise<boolean> {
    throw new StorageNotConfiguredError();
  }
  async getSignedUrl(): Promise<string> {
    throw new StorageNotConfiguredError();
  }
}

export const storage: StorageProvider = new UnconfiguredStorageProvider();
