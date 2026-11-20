import { env } from '../../config/env.js';
import { LocalStorageService } from './local-storage.js';
import { S3StorageService } from './s3-storage.js';
import type { StorageService } from './storage.js';

export * from './storage.js';
export { LocalStorageService } from './local-storage.js';

function createStorage(): StorageService {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3StorageService({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalStorageService(
    env.STORAGE_LOCAL_DIR,
    env.STORAGE_SIGNING_SECRET,
    env.PUBLIC_API_URL,
  );
}

export const storage: StorageService = createStorage();
