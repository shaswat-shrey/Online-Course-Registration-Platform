import { z } from 'zod';

/** Public branding/profile fields shown on the login page and portal header. */
export const publicUniversitySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    shortName: z.string(),
    timezone: z.string(),
    schoolLabel: z.string(),
    website: z.string().nullable(),
    contactEmail: z.string().nullable(),
  })
  .meta({ id: 'PublicUniversity' });

export type PublicUniversity = z.infer<typeof publicUniversitySchema>;
