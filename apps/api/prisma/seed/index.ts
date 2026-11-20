/**
 * Idempotent development seed (DATABASE.md §9–10). Safe to run repeatedly:
 * every record is looked up by a natural key before being created.
 */
import 'dotenv/config';
import { RoleKey } from '@ucrams/shared';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/redis.js';
import { closeQueues } from '../../src/infrastructure/queues/queues.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { invalidateAuthState } from '../../src/modules/authz/grants.service.js';
import { syncRbacCatalog } from '../../src/modules/rbac/rbac.bootstrap.js';
import { seedCatalog } from './courses.js';
import { seedCommunication } from './communication.js';
import { seedAcademics } from './academics.js';
import { seedPeople } from './people.js';
import { seedRegistrations } from './registrations.js';
import { seedTeaching } from './teaching.js';
import { seedStructure } from './structure.js';

async function seedUniversity() {
  const existing = await prisma.university.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return;
  await prisma.university.create({
    data: {
      name: 'Northbridge University',
      shortName: 'NBU',
      timezone: 'Asia/Kolkata',
      website: 'https://northbridge.example.edu',
      contactEmail: 'registrar@northbridge.example.edu',
      contactPhone: '+91 80 0000 0000',
      address: '1 University Avenue, Bengaluru, India',
      schoolLabel: 'Faculty',
    },
  });
  console.warn('Created university profile.');
}

/** Development accounts, one per role (README "Development credentials"). */
const DEV_ACCOUNTS: ReadonlyArray<{
  email: string;
  firstName: string;
  lastName: string;
  role: RoleKey;
  /** Department code for DEPARTMENT-scoped roles. */
  department?: string;
}> = [
  {
    email: 'superadmin@ucrams.local',
    firstName: 'Sam',
    lastName: 'Superadmin',
    role: RoleKey.SUPER_ADMIN,
  },
  {
    email: 'uniadmin@ucrams.local',
    firstName: 'Uma',
    lastName: 'Universityadmin',
    role: RoleKey.UNIVERSITY_ADMIN,
  },
  {
    email: 'registrar@ucrams.local',
    firstName: 'Riya',
    lastName: 'Registrar',
    role: RoleKey.ACADEMIC_ADMIN,
  },
  {
    email: 'cs.admin@ucrams.local',
    firstName: 'Dev',
    lastName: 'Deptadmin',
    role: RoleKey.DEPARTMENT_ADMIN,
    department: 'CS',
  },
  {
    email: 'faculty.cs@ucrams.local',
    firstName: 'Farhan',
    lastName: 'Faculty',
    role: RoleKey.FACULTY,
  },
  {
    email: 'student.cs@ucrams.local',
    firstName: 'Sara',
    lastName: 'Student',
    role: RoleKey.STUDENT,
  },
];

async function seedDevAccounts() {
  const password = process.env.SEED_DEV_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error(
      'Set SEED_DEV_PASSWORD (>= 10 characters) in apps/api/.env to seed development accounts.',
    );
  }
  const passwordHash = await hashPassword(password);
  for (const account of DEV_ACCOUNTS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: account.role } });
    let user = await prisma.user.findUnique({ where: { email: account.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: account.email,
          firstName: account.firstName,
          lastName: account.lastName,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      console.warn(`Created ${account.email} (${account.role}).`);
    }
    const scope = account.department
      ? {
          scopeType: 'DEPARTMENT' as const,
          scopeId: (
            await prisma.department.findUniqueOrThrow({ where: { code: account.department } })
          ).id,
        }
      : { scopeType: 'GLOBAL' as const, scopeId: null };
    const hasRole = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id, ...scope },
    });
    if (!hasRole) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, ...scope } });
      await invalidateAuthState([user.id]);
    }
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'The development seed must not run in production. Use `npm run bootstrap:admin`.',
    );
  }
  const rbac = await syncRbacCatalog({ resetSystemRoles: process.argv.includes('--reset-roles') });
  console.warn(
    `RBAC catalogue synced: ${rbac.permissions} permissions, ${rbac.rolesCreated} roles created.`,
  );
  await seedUniversity();
  const structure = await seedStructure();
  console.warn(
    `Structure seeded (${structure.departments.size} departments, ${structure.programsCreated} programs created).`,
  );
  await seedDevAccounts();
  const people = await seedPeople(await hashPassword(process.env.SEED_DEV_PASSWORD!));
  console.warn(`People seeded (${people.faculty} faculty, ${people.students} students).`);
  const catalog = await seedCatalog();
  console.warn(
    `Catalog seeded (${catalog.classrooms} classrooms, ${catalog.courses} courses, ${catalog.sections} sections created).`,
  );
  const registrations = await seedRegistrations();
  console.warn(`Registrations seeded (${registrations.created} created).`);
  const teaching = await seedTeaching();
  console.warn(
    `Teaching seeded (${teaching.materials} materials, ${teaching.announcements} announcements).`,
  );
  const communication = await seedCommunication();
  console.warn(`Communication ${communication.created ? 'seeded' : 'already present'}.`);
  const academics = await seedAcademics();
  console.warn(`Attendance and assessments seeded for ${academics.sections} section(s).`);
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
