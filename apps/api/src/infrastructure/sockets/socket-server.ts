import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { ErrorCode } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { AppError } from '../../common/exceptions/app-error.js';
import { resolveActor } from '../../common/guards/authenticate.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { createPubSubPair } from '../redis/redis.js';

/**
 * Socket.IO gateway (ARCHITECTURE.md §11). WebSocket transport only, so no
 * sticky sessions are needed; Redis adapter fans events out across instances.
 *
 * Handshake authentication: the client sends its access token in `auth.token`;
 * the same verification as HTTP applies (signature, expiry, revoked session,
 * account status). On TOKEN_EXPIRED the client refreshes and reconnects.
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

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    try {
      if (typeof token !== 'string' || token.length === 0) throw new Error('missing');
      const actor = await resolveActor(token, {
        ip: socket.handshake.address ?? null,
        userAgent: socket.handshake.headers['user-agent']?.slice(0, 500) ?? null,
        requestId: socket.id,
      });
      (socket.data as { actor?: ActorContext }).actor = actor;
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : ErrorCode.UNAUTHENTICATED;
      const error = new Error('Authentication required') as Error & { data?: unknown };
      error.data = { code };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const actor = (socket.data as { actor: ActorContext }).actor;
    void socket.join(`user:${actor.userId}`);
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
