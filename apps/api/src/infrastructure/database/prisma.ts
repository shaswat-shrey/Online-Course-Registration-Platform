import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';

export type { PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/** Process-wide Prisma client (one connection pool per process). */
export const prisma = createPrismaClient();

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
