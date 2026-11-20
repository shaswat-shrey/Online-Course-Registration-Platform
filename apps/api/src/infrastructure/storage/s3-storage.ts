import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** S3-compatible storage (AWS S3, MinIO, Cloudflare R2). */
export class S3StorageService implements StorageService {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async getObjectHead(key: string, bytes: number): Promise<Buffer> {
    assertSafeKey(key);
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async headObject(key: string): Promise<ObjectInfo | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<PresignedUpload> {
    assertSafeKey(key);
    const expiresIn = options.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    // Size is re-verified server-side on completion (FR-FILE-001); S3 presigned PUT
    // cannot enforce a maximum by itself.
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: options.contentType }),
      { expiresIn },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: DownloadUrlOptions = {}): Promise<string> {
    assertSafeKey(key);
    const disposition = options.disposition ?? 'attachment';
    const filename = options.filename ? sanitizeFilename(options.filename) : undefined;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: filename
          ? `${disposition}; filename="${filename}"`
          : disposition,
      }),
      { expiresIn: options.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS },
    );
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
