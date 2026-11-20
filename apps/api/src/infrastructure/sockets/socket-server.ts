import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { ErrorCode } from '@ucrams/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { createPubSubPair } from '../redis/redis.js';

/**
 * Socket.IO gateway (ARCHITECTURE.md §11). WebSocket transport only, so no
 * sticky sessions are needed; Redis adapter fans events out across instances.
 *
 * Phase 1: the handshake rejects every connection because authentication
 * does not exist yet. Phase 2 replaces this with JWT + session verification.
 */
export function attachSocketServer(httpServer: HttpServer): {
  io: Server;
  close: () => Promise<void>;
} {
  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    serveClient: false,
  });
  const { pub, sub } = createPubSubPair();
  io.adapter(createAdapter(pub, sub));

  io.use((_socket, next) => {
    const error = new Error('Authentication required') as Error & { data?: unknown };
    error.data = { code: ErrorCode.UNAUTHENTICATED };
    next(error);
  });

  logger.info('Socket.IO gateway attached');
  return {
    io,
    close: async () => {
      await io.close();
      pub.disconnect();
      sub.disconnect();
    },
  };
}
