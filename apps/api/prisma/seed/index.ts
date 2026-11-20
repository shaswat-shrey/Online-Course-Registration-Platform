/**
 * Idempotent development seed (DATABASE.md §9–10). Safe to run repeatedly.
 * Phase 1 seeds only the university profile; later phases extend this file.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function seedUniversity() {
  const data = {
    name: 'Northbridge University',
    shortName: 'NBU',
    timezone: 'Asia/Kolkata',
    website: 'https://northbridge.example.edu',
    contactEmail: 'registrar@northbridge.example.edu',
    contactPhone: '+91 80 0000 0000',
    address: '1 University Avenue, Bengaluru, India',
    schoolLabel: 'Faculty',
  };
  const existing = await prisma.university.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    console.warn(`University exists (${existing.shortName}); leaving it unchanged.`);
    return;
  }
  await prisma.university.create({ data });
  console.warn(`Created university ${data.shortName}.`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed must not run in production.');
  }
  await seedUniversity();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
