import {
  ErrorCode,
  weightedPercent,
  type assessmentCreateSchema,
  type assessmentScoresSchema,
  type assessmentUpdateSchema,
} from '@ucrams/shared';
import type { z } from 'zod';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { queueNotifications } from '../notifications/notifications.service.js';
import { assertInSection, canInSection, sectionAccess } from '../teaching/teaching-access.js';
import { CLASS_LIST, classList } from './attendance.service.js';

type AssessmentRow = Awaited<ReturnType<typeof prisma.assessment.findMany>>[number];

const dto = (a: AssessmentRow) => ({
  id: a.id,
  title: a.title,
  type: a.type,
  weight: a.weight.toNumber(),
  maxScore: a.maxScore.toNumber(),
  dueAt: a.dueAt?.toISOString() ?? null,
  published: !!a.publishedAt,
  publishedAt: a.publishedAt?.toISOString() ?? null,
  position: a.position,
});

/** Total weight of a section's components; must reach 100 % before grades are submitted. */
export async function totalWeight(sectionId: string) {
  const agg = await prisma.assessment.aggregate({ where: { sectionId }, _sum: { weight: true } });
  return agg._sum.weight?.toNumber() ?? 0;
}

/**
 * Weighted mark per student over the given components (all for instructors,
 * published ones for students), using the shared rule in `weightedPercent`.
 */
export async function computedPercents(sectionId: string, publishedOnly = false) {
  const assessments = await prisma.assessment.findMany({
    where: { sectionId, ...(publishedOnly ? { publishedAt: { not: null } } : {}) },
    include: { scores: true },
  });
  const students = new Set(assessments.flatMap((a) => a.scores.map((s) => s.studentId)));
  const out = new Map<string, number | null>();
  for (const studentId of students)
    out.set(
      studentId,
      weightedPercent(
        assessments.map((a) => {
          const s = a.scores.find((x) => x.studentId === studentId);
          return {
            weight: a.weight.toNumber(),
            maxScore: a.maxScore.toNumber(),
            score: s?.score?.toNumber() ?? null,
            excused: s?.excused ?? false,
          };
        }),
      ),
    );
  return { out, hasComponents: assessments.length > 0 };
}

/** The gradebook for instructors and covering administrators (FR-ACAD-004). */
export async function gradebook(actor: ActorContext, sectionId: string) {
  const access = await sectionAccess(actor, sectionId);
  const manage = canInSection(actor, access, 'assessment:manage');
  if (!manage) assertInSection(actor, access, 'roster:read');
  const [assessments, students, percents] = await Promise.all([
    prisma.assessment.findMany({
      where: { sectionId },
      include: { scores: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    classList(sectionId),
    computedPercents(sectionId),
  ]);
  return {
    canManage: manage,
    totalWeight: assessments.reduce((s, a) => s + a.weight.toNumber(), 0),
    assessments: assessments.map(dto),
    students: students.map((st) => ({
      ...st,
      percent: percents.out.get(st.studentId) ?? (assessments.length ? 0 : null),
      scores: Object.fromEntries(
        assessments.map((a) => {
          const s = a.scores.find((x) => x.studentId === st.studentId);
          return [
            a.id,
            s
              ? { score: s.score?.toNumber() ?? null, excused: s.excused, feedback: s.feedback }
              : null,
          ];
        }),
      ),
    })),
  };
}

async function managed(actor: ActorContext, id: string) {
  const a = await prisma.assessment.findUnique({ where: { id } });
  if (!a) throw new NotFoundError('Assessment');
  const access = await sectionAccess(actor, a.sectionId);
  assertInSection(actor, access, 'assessment:manage');
  return { a, access };
}

async function assertWeight(sectionId: string, weight: number, excludeId?: string) {
  const agg = await prisma.assessment.aggregate({
    where: { sectionId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { weight: true },
  });
  const total = (agg._sum.weight?.toNumber() ?? 0) + weight;
  if (total > 100.0001)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Weights would exceed 100 %', {
      fields: [
        {
          path: 'body.weight',
          message: `At most ${Math.max(0, 100 - (total - weight)).toFixed(2)} % is left`,
        },
      ],
    });
}

export async function createAssessment(
  actor: ActorContext,
  sectionId: string,
  input: z.output<typeof assessmentCreateSchema>,
) {
  const access = await sectionAccess(actor, sectionId);
  assertInSection(actor, access, 'assessment:manage');
  await assertWeight(sectionId, input.weight);
  const last = await prisma.assessment.aggregate({
    where: { sectionId },
    _max: { position: true },
  });
  const a = await prisma.assessment.create({
    data: {
      sectionId,
      title: input.title,
      type: input.type,
      weight: input.weight,
      maxScore: input.maxScore,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      position: (last._max.position ?? -1) + 1,
    },
  });
  return dto(a);
}

/** Publishing shows the component and its scores to students, who are notified once. */
export async function updateAssessment(
  actor: ActorContext,
  id: string,
  input: z.output<typeof assessmentUpdateSchema>,
) {
  const { a, access } = await managed(actor, id);
  if (input.weight !== undefined) await assertWeight(a.sectionId, input.weight, id);
  if (input.maxScore !== undefined) {
    const over = await prisma.assessmentScore.count({
      where: { assessmentId: id, score: { gt: input.maxScore } },
    });
    if (over)
      throw new BusinessRuleError(
        ErrorCode.VALIDATION_ERROR,
        'Some scores exceed the new maximum',
        {
          fields: [{ path: 'body.maxScore', message: `${over} score(s) are higher` }],
        },
      );
  }
  const { published, dueAt, ...rest } = input;
  const publishing = published === true && !a.publishedAt;
  let after: () => void = () => undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.assessment.update({
      where: { id },
      data: {
        ...rest,
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        ...(published !== undefined
          ? { publishedAt: published ? (a.publishedAt ?? new Date()) : null }
          : {}),
      },
    });
    if (publishing) {
      const regs = await tx.courseRegistration.findMany({
        where: { sectionId: a.sectionId, status: { in: [...CLASS_LIST] } },
        select: { student: { select: { userId: true } } },
      });
      const label = `${access.section.course.code} ${access.section.sectionCode}`;
      after = await queueNotifications(
        tx,
        regs.map((r) => ({
          userId: r.student.userId,
          category: 'GRADES',
          title: `${label}: ${u.title} results published`,
          body: `Your score for ${u.title} is now visible.`,
          link: `/student/courses/${a.sectionId}?tab=assessments`,
        })),
      );
    }
    return u;
  });
  after();
  return dto(updated);
}

export async function deleteAssessment(actor: ActorContext, id: string) {
  const { a } = await managed(actor, id);
  await prisma.assessment.delete({ where: { id } });
  await recordAudit(actor, {
    action: 'assessment.deleted',
    entityType: 'Assessment',
    entityId: id,
    changes: { sectionId: a.sectionId, title: a.title },
  });
}

/** Enters scores (FR-ACAD-004); every score is within 0..max and for a student in the section. */
export async function saveScores(
  actor: ActorContext,
  id: string,
  input: z.output<typeof assessmentScoresSchema>,
) {
  const { a } = await managed(actor, id);
  const max = a.maxScore.toNumber();
  const listed = new Set((await classList(a.sectionId)).map((x) => x.studentId));
  const bad = input.scores.filter((s) => !listed.has(s.studentId));
  if (bad.length)
    throw new BusinessRuleError(
      ErrorCode.VALIDATION_ERROR,
      'Some students are not in this section',
      {
        fields: [{ path: 'body.scores', message: `${bad.length} student(s) not in the section` }],
      },
    );
  const over = input.scores.filter((s) => s.score !== null && s.score > max);
  if (over.length)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, `Scores cannot exceed ${max}`, {
      fields: [{ path: 'body.scores', message: `${over.length} score(s) above the maximum` }],
    });
  await prisma.$transaction(
    input.scores.map((s) =>
      prisma.assessmentScore.upsert({
        where: { assessmentId_studentId: { assessmentId: id, studentId: s.studentId } },
        create: {
          assessmentId: id,
          studentId: s.studentId,
          score: s.score,
          excused: s.excused,
          feedback: s.feedback,
        },
        update: { score: s.score, excused: s.excused, feedback: s.feedback },
      }),
    ),
  );
  return { saved: input.scores.length };
}

/** A student's published components and scores, with the running weighted mark. */
export async function myAssessments(actor: ActorContext, sectionId: string) {
  const student = await prisma.student.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  const held = student
    ? await prisma.courseRegistration.count({
        where: { sectionId, studentId: student.id, status: { in: [...CLASS_LIST] } },
      })
    : 0;
  if (!student || !held) throw new NotFoundError('Section');
  const assessments = await prisma.assessment.findMany({
    where: { sectionId, publishedAt: { not: null } },
    include: { scores: { where: { studentId: student.id } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const items = assessments.map((a) => {
    const s = a.scores[0];
    return {
      ...dto(a),
      score: s?.score?.toNumber() ?? null,
      excused: s?.excused ?? false,
      feedback: s?.feedback ?? null,
    };
  });
  return {
    items,
    percent: weightedPercent(
      items
        .filter((i) => i.score !== null || i.excused)
        .map((i) => ({
          weight: i.weight,
          maxScore: i.maxScore,
          score: i.score,
          excused: i.excused,
        })),
    ),
  };
}
