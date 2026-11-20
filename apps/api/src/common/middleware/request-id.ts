import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import 'pino-http'; // provides the req.id type augmentation

const VALID_INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns a request ID (reusing a well-formed X-Request-Id from the proxy)
 * and echoes it in the response for log correlation.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
