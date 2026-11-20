import { NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { PublicUniversity } from './university.schemas.js';

export async function getPublicUniversity(): Promise<PublicUniversity> {
  const university = await prisma.university.findFirst({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      shortName: true,
      timezone: true,
      schoolLabel: true,
      website: true,
      contactEmail: true,
    },
  });
  if (!university) throw new NotFoundError('University profile');
  return university;
}
