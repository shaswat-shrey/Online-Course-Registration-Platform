/**
 * Academic management seed (Phase 10): attendance for the first weeks and a
 * published quiz plus an unpublished assignment, with scores, in the running
 * sections taught by the dev faculty account and attended by the dev student.
 * Runs once (skipped when any assessment exists). Deterministic marks.
 */
import { prisma } from '../../src/infrastructure/database/prisma.js';

const STATUSES = ['PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'PRESENT', 'ABSENT', 'PRESENT'] as const;

export async function seedAcademics() {
  if ((await prisma.assessment.count()) > 0) return { sections: 0 };
  const [faculty, student] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'faculty.cs@ucrams.local' }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: 'student.cs@ucrams.local' }, select: { id: true } }),
  ]);
  if (!faculty || !student) return { sections: 0 };
  const sections = await prisma.courseSection.findMany({
    where: {
      status: 'PUBLISHED',
      session: { status: 'ACTIVE' },
      OR: [
        { instructors: { some: { facultyMember: { userId: faculty.id } } } },
        { registrations: { some: { status: 'REGISTERED', student: { userId: student.id } } } },
      ],
    },
    select: {
      id: true,
      meetings: { select: { dayOfWeek: true, startMinute: true }, orderBy: { dayOfWeek: 'asc' } },
      session: { select: { startDate: true } },
      instructors: {
        where: { role: 'PRIMARY' },
        select: { facultyMember: { select: { userId: true } } },
      },
      registrations: { where: { status: 'REGISTERED' }, select: { studentId: true } },
    },
  });
  for (const s of sections) {
    const takerId = s.instructors[0]?.facultyMember.userId ?? faculty.id;
    const studentIds = s.registrations.map((r) => r.studentId);
    const meeting = s.meetings[0];
    // Six weekly classes from the first meeting day of the session.
    for (let week = 0; week < 6 && meeting; week++) {
      const date = new Date(s.session.startDate);
      const startDay = ((date.getUTCDay() + 6) % 7) + 1;
      date.setUTCDate(date.getUTCDate() + ((meeting.dayOfWeek - startDay + 7) % 7) + week * 7);
      await prisma.attendanceSession.create({
        data: {
          sectionId: s.id,
          date,
          startMinute: meeting.startMinute,
          topic: `Week ${week + 1}`,
          createdById: takerId,
          records: {
            create: studentIds.map((studentId, i) => ({
              studentId,
              status: STATUSES[(i + week) % STATUSES.length]!,
            })),
          },
        },
      });
    }
    const quiz = await prisma.assessment.create({
      data: {
        sectionId: s.id,
        title: 'Quiz 1',
        type: 'QUIZ',
        weight: 15,
        maxScore: 20,
        dueAt: new Date('2026-09-04T12:30:00Z'),
        publishedAt: new Date('2026-09-10T06:00:00Z'),
        position: 0,
      },
    });
    const midterm = await prisma.assessment.create({
      data: {
        sectionId: s.id,
        title: 'Mid-session test',
        type: 'EXAM',
        weight: 25,
        maxScore: 50,
        dueAt: new Date('2026-10-12T06:00:00Z'),
        publishedAt: new Date('2026-10-20T06:00:00Z'),
        position: 1,
      },
    });
    await prisma.assessment.create({
      data: {
        sectionId: s.id,
        title: 'Project',
        type: 'PROJECT',
        weight: 20,
        maxScore: 100,
        dueAt: new Date('2026-11-27T12:30:00Z'),
        position: 2,
      },
    });
    await prisma.assessmentScore.createMany({
      data: studentIds.flatMap((studentId, i) => [
        { assessmentId: quiz.id, studentId, score: 10 + ((i * 7) % 11) },
        { assessmentId: midterm.id, studentId, score: 24 + ((i * 13) % 27) },
      ]),
    });
  }
  return { sections: sections.length };
}
