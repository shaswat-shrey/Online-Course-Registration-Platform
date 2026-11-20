import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertSafeKey,
  DEFAULT_URL_TTL_SECONDS,
  sanitizeFilename,
  type DownloadUrlOptions,
  type ObjectInfo,
  type PresignedUpload,
  type StorageService,
  type UploadUrlOptions,
} from './storage.js';

export class FileTooLargeError extends Error {
  constructor() {
    super('File exceeds the allowed size');
  }
}

export interface LocalTokenPayload {
  op: 'put' | 'get';
  key: string;
  exp: number;
  /** put: required content type */
  ct?: string;
  /** put: maximum bytes */
  max?: number;
  /** get: suggested filename */
  fn?: string;
  /** get: disposition */
  disp?: 'inline' | 'attachment';
}

/**
 * Filesystem storage for development without S3/MinIO. Presigned URLs are
 * HMAC-signed tokens served by the API route in local-storage.routes.ts.
 * Not intended for production.
 */
export class LocalStorageService implements StorageService {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly signingSecret: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = path.resolve(rootDir);
  }

  private filePath(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Storage key escapes root');
    return full;
  }

  private metaPath(key: string): string {
    return `${this.filePath(key)}.meta.json`;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(this.metaPath(key), JSON.stringify({ contentType }));
  }

  /**
   * Streams an upload to disk, aborting (and removing the partial file) once
   * more than `maxBytes` arrive. Returns the number of bytes written.
   */
  async writeStream(
    key: string,
    source: Readable,
    contentType: string,
    maxBytes: number,
  ): Promise<number> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        received += chunk.length;
        if (received > maxBytes) callback(new FileTooLargeError());
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(source, limiter, createWriteStream(file));
    } catch (err) {
      await rm(file, { force: true });
      throw err;
    }
    await writeFile(this.metaPath(key), JSON.stringify({ contentType }));
    return received;
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.filePath(key));
  }

  async getObjectHead(key: string, bytes: number): Promise<Buffer> {
    const handle = await open(this.filePath(key), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async headObject(key: string): Promise<ObjectInfo | null> {
    try {
      const info = await stat(this.filePath(key));
      let contentType: string | undefined;
      try {
        contentType = JSON.parse(await readFile(this.metaPath(key), 'utf8')).contentType;
      } catch {
        contentType = undefined;
      }
      return { size: info.size, contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<PresignedUpload> {
    assertSafeKey(key);
    const exp =
      Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS);
    const token = this.sign({
      op: 'put',
      key,
      exp,
      ct: options.contentType,
      max: options.maxBytes,
    });
    return {
      url: `${this.publicBaseUrl}/api/v1/storage/local/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: DownloadUrlOptions = {}): Promise<string> {
    assertSafeKey(key);
    const exp =
      Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS);
    const token = this.sign({
      op: 'get',
      key,
      exp,
      fn: options.filename ? sanitizeFilename(options.filename) : undefined,
      disp: options.disposition ?? 'attachment',
    });
    return `${this.publicBaseUrl}/api/v1/storage/local/${token}`;
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await stat(this.root);
  }

  sign(payload: LocalTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Returns the payload if the token is authentic and unexpired, otherwise null. */
  verify(token: string): LocalTokenPayload | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as LocalTokenPayload;
      if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000))
        return null;
      assertSafeKey(payload.key);
      return payload;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.signingSecret).update(body).digest('base64url');
  }
}
