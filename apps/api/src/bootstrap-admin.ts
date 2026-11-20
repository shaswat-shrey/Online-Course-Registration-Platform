/**
 * Production bootstrap (DATABASE.md §9): syncs the RBAC catalogue and creates
 * the first Super Administrator as an INVITED account, then issues an
 * invitation link. The operator delivers the link (email is also queued).
 *
 *   BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_FIRST_NAME=… BOOTSTRAP_ADMIN_LAST_NAME=… npm run bootstrap:admin
 */
import 'dotenv/config';
import { RoleKey } from '@ucrams/shared';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './infrastructure/database/prisma.js';
import { closeQueues } from './infrastructure/queues/queues.js';
import { redis } from './infrastructure/redis/redis.js';
import { issueInvitation } from './modules/auth/auth.service.js';
import { syncRbacCatalog } from './modules/rbac/rbac.bootstrap.js';

const input = z
  .object({
    BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    BOOTSTRAP_ADMIN_FIRST_NAME: z.string().trim().min(1),
    BOOTSTRAP_ADMIN_LAST_NAME: z.string().trim().min(1),
  })
  .parse(process.env);

async function main() {
  await syncRbacCatalog();
  const existingSuper = await prisma.userRole.count({
    where: { role: { key: RoleKey.SUPER_ADMIN } },
  });
  if (existingSuper > 0) {
    console.warn('A Super Administrator already exists; nothing to do.');
    return;
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { key: RoleKey.SUPER_ADMIN } });
  const user = await prisma.user.create({
    data: {
      email: input.BOOTSTRAP_ADMIN_EMAIL,
      firstName: input.BOOTSTRAP_ADMIN_FIRST_NAME,
      lastName: input.BOOTSTRAP_ADMIN_LAST_NAME,
      status: 'INVITED',
      roles: { create: { roleId: role.id, scopeType: 'GLOBAL' } },
    },
  });
  const token = await issueInvitation(user.id);
  console.warn(
    `Super Administrator invited. Activation link (valid ${env.INVITE_TOKEN_TTL_HOURS} h):`,
  );
  console.warn(`${env.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
  });
