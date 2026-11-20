import axios from 'axios';
import { FILE_LIMITS } from '@ucrams/shared';
import { ApiError } from '@/services/api-error';
import { apiPost } from '@/services/http';

/**
 * Upload flow (FR-FILE-001): ask for an intent, PUT the bytes to the signed URL,
 * then ask the server to verify the content. Returns the verified file id.
 */
export async function uploadAvatarFile(file: File): Promise<string> {
  const limits = FILE_LIMITS.AVATAR;
  if (!(limits.mimeTypes as readonly string[]).includes(file.type)) {
    throw new ApiError(422, 'FILE_TYPE_NOT_ALLOWED', 'Choose a PNG, JPEG or WebP image');
  }
  if (file.size > limits.maxBytes)
    throw new ApiError(422, 'FILE_TOO_LARGE', 'Images must be at most 5 MB');
  const intent = await apiPost<{
    fileId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('/files/upload-intents', {
    context: 'AVATAR',
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  try {
    await axios.put(intent.upload.url, file, { headers: intent.upload.headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The upload did not complete. Try again.');
  }
  await apiPost(`/files/${intent.fileId}/complete`);
  return intent.fileId;
}
