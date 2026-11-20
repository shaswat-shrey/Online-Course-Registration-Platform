import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';

export type { PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    // Registration transactions queue on row locks of busy sections (ARCHITECTURE.md §8):
    // allow time to obtain a connection and to wait for the lock, but keep each bounded.
    transactionOptions: { maxWait: 15_000, timeout: 20_000 },
  });
}

/** Process-wide Prisma client (one connection pool per process). */
export const prisma = createPrismaClient();

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
