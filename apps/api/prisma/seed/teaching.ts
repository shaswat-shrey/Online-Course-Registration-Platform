/**
 * Faculty workspace seed (Phase 7): reading-list links and announcements for the
 * dev faculty account's current sections. Runs once (skipped when any exist).
 */
import { prisma } from '../../src/infrastructure/database/prisma.js';

export async function seedTeaching() {
  const faculty = await prisma.facultyMember.findFirst({
    where: { user: { email: 'faculty.cs@ucrams.local' } },
    select: { id: true, userId: true },
  });
  if (!faculty) return { materials: 0, announcements: 0 };
  const sections = await prisma.courseSection.findMany({
    where: {
      instructors: { some: { facultyMemberId: faculty.id } },
      session: { status: 'ACTIVE' },
      status: 'PUBLISHED',
    },
    include: { course: { select: { code: true, title: true } } },
    orderBy: { course: { code: 'asc' } },
  });
  if (
    !sections.length ||
    (await prisma.sectionMaterial.count({
      where: { sectionId: { in: sections.map((s) => s.id) } },
    })) > 0
  )
    return { materials: 0, announcements: 0 };
  let materials = 0;
  for (const s of sections) {
    const items = [
      {
        folder: 'Course information',
        title: 'Course outline',
        url: `https://catalog.northbridge.example.edu/courses/${s.course.code.toLowerCase()}`,
        published: true,
      },
      {
        folder: 'Week 1',
        title: 'Reading: introduction chapter',
        url: 'https://library.northbridge.example.edu/reserves/week-1',
        published: true,
      },
      {
        folder: 'Week 2',
        title: 'Problem set 1 (draft)',
        url: 'https://library.northbridge.example.edu/reserves/problem-set-1',
        published: false,
      },
    ];
    for (const [position, m] of items.entries()) {
      await prisma.sectionMaterial.create({
        data: {
          sectionId: s.id,
          folder: m.folder,
          title: m.title,
          kind: 'LINK',
          url: m.url,
          position,
          publishedAt: m.published ? new Date('2026-08-03T04:00:00Z') : null,
          createdById: faculty.userId,
        },
      });
      materials++;
    }
  }
  const first = sections[0]!;
  await prisma.announcement.create({
    data: {
      authorId: faculty.userId,
      title: 'Welcome to the course',
      body: 'Slides and readings are under Materials. Office hours are on the course outline.',
      pinned: true,
      publishedAt: new Date('2026-08-03T04:30:00Z'),
      audiences: {
        create: sections.map((s) => ({ targetType: 'SECTION' as const, targetId: s.id })),
      },
    },
  });
  await prisma.announcement.create({
    data: {
      authorId: faculty.userId,
      title: `${first.course.code}: mid-session test moved`,
      body: 'The mid-session test moves to the following Monday, same time and room.',
      priority: 'IMPORTANT',
      publishedAt: new Date('2026-10-05T06:00:00Z'),
      audiences: { create: [{ targetType: 'SECTION', targetId: first.id }] },
    },
  });
  return { materials, announcements: 2 };
}
