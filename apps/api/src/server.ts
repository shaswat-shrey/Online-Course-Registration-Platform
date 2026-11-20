import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './infrastructure/database/prisma.js';
import { closeQueues } from './infrastructure/queues/queues.js';
import { redis } from './infrastructure/redis/redis.js';
import { attachSocketServer } from './infrastructure/sockets/socket-server.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main() {
  const app = createApp();
  const httpServer = createServer(app);
  const sockets = attachSocketServer(httpServer);

  httpServer.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `API listening on http://localhost:${env.PORT}`,
    );
    if (env.API_DOCS_ENABLED) logger.info(`API docs at http://localhost:${env.PORT}/api/docs`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API');
    const timer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    await sockets.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
    logger.info('API stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ err: reason }, 'Unhandled rejection'),
  );
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
