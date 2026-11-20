import { Router } from 'express';
import { z } from 'zod';
import { ErrorCode } from '@ucrams/shared';
import { AppError, NotFoundError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { FileTooLargeError, type LocalStorageService } from './local-storage.js';

/**
 * Serves presigned URLs for the development `local` storage driver.
 * Mounted only when STORAGE_DRIVER=local. The HMAC token is the authorization.
 */
export function createLocalStorageRouter(store: LocalStorageService): Router {
  const router = Router();
  const params = z.object({ token: z.string().min(10).max(4096) });

  defineRoute(
    router,
    {
      method: 'put',
      path: '/storage/local/:token',
      summary: 'Upload to local dev storage via signed URL',
      tags: ['Storage'],
      access: { public: true },
      hidden: true,
      request: { params },
      responses: { 204: { description: 'Stored' } },
    },
    async (req, res) => {
      const payload = store.verify(req.valid.params.token);
      if (!payload || payload.op !== 'put' || !payload.ct || !payload.max)
        throw new NotFoundError('Upload URL');
      if (req.header('content-type') !== payload.ct) {
        throw new AppError(
          422,
          ErrorCode.FILE_TYPE_NOT_ALLOWED,
          'Content-Type does not match upload URL',
        );
      }
      const declared = Number(req.header('content-length'));
      if (Number.isFinite(declared) && declared > payload.max) {
        throw new AppError(422, ErrorCode.FILE_TOO_LARGE, 'File exceeds the allowed size');
      }
      try {
        await store.writeStream(payload.key, req, payload.ct, payload.max);
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          throw new AppError(422, ErrorCode.FILE_TOO_LARGE, 'File exceeds the allowed size');
        }
        throw err;
      }
      res.status(204).end();
    },
  );

  defineRoute(
    router,
    {
      method: 'get',
      path: '/storage/local/:token',
      summary: 'Download from local dev storage via signed URL',
      tags: ['Storage'],
      access: { public: true },
      hidden: true,
      request: { params },
      responses: { 200: { description: 'File contents' } },
    },
    async (req, res) => {
      const payload = store.verify(req.valid.params.token);
      if (!payload || payload.op !== 'get') throw new NotFoundError('Download URL');
      const info = await store.headObject(payload.key);
      if (!info) throw new NotFoundError('File');
      const disposition = payload.disp ?? 'attachment';
      res.setHeader('Content-Type', info.contentType ?? 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        payload.fn ? `${disposition}; filename="${payload.fn}"` : disposition,
      );
      res.send(await store.getObject(payload.key));
    },
  );

  return router;
}
