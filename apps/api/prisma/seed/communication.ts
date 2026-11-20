/**
 * Communication seed (Phase 9): a direct conversation, section chat and a
 * discussion thread for the dev faculty/student accounts, university and
 * department announcements, feedback and support tickets. Runs once (skipped
 * when any ticket exists). Seeded announcements are marked as already
 * delivered so the worker does not notify everyone again.
 */
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { syncSectionConversation } from '../../src/modules/messaging/conversation-access.js';
import { nextSequence } from '../../src/modules/users/id-sequences.js';

const at = (iso: string) => new Date(iso);

async function user(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

export async function seedCommunication() {
  if ((await prisma.supportTicket.count()) > 0) return { created: false };
  const [student, faculty, deptAdmin, uniAdmin] = await Promise.all([
    user('student.cs@ucrams.local'),
    user('faculty.cs@ucrams.local'),
    user('cs.admin@ucrams.local'),
    user('uniadmin@ucrams.local'),
  ]);
  if (!student || !faculty || !deptAdmin || !uniAdmin) return { created: false };
  const cs = await prisma.department.findFirst({ where: { code: 'CS' }, select: { id: true } });

  // A current section the dev faculty member teaches, preferably one the dev student attends.
  const sections = await prisma.courseSection.findMany({
    where: {
      instructors: { some: { facultyMember: { userId: faculty.id } } },
      session: { status: 'ACTIVE' },
      status: 'PUBLISHED',
    },
    select: {
      id: true,
      sectionCode: true,
      course: { select: { code: true } },
      registrations: {
        where: { status: 'REGISTERED' },
        select: { student: { select: { userId: true } } },
        take: 5,
      },
    },
    orderBy: { course: { code: 'asc' } },
  });
  const shared = sections.find((s) => s.registrations.some((r) => r.student.userId === student.id));
  const section = shared ?? sections[0];

  if (section) {
    const conversationId = await syncSectionConversation(section.id, faculty.id);
    const classmate = section.registrations.find((r) => r.student.userId !== student.id);
    const lines: Array<[string, string, string]> = [
      [
        faculty.id,
        'Welcome! Use this chat for quick questions about the course.',
        '2026-08-04T05:00:00Z',
      ],
      ...(classmate
        ? ([
            [
              classmate.student.userId,
              'Is the first problem set due on Friday or Monday?',
              '2026-11-18T10:15:00Z',
            ],
          ] as Array<[string, string, string]>)
        : []),
      [faculty.id, 'Friday 23:59. Late submissions lose 10% per day.', '2026-11-18T11:02:00Z'],
    ];
    for (const [senderId, body, when] of lines)
      await prisma.message.create({
        data: { conversationId, senderId, body, createdAt: at(when) },
      });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at(lines.at(-1)![2]) },
    });

    const askerId = shared ? student.id : classmate?.student.userId;
    if (askerId) {
      const thread = await prisma.discussionThread.create({
        data: {
          sectionId: section.id,
          authorId: askerId,
          type: 'QUESTION',
          title: 'Does the recursion depth limit count towards complexity?',
          body: 'In problem 3, should we include the call stack when stating space complexity?',
          createdAt: at('2026-11-17T09:30:00Z'),
          lastActivityAt: at('2026-11-17T12:10:00Z'),
          replyCount: 1,
        },
      });
      const answer = await prisma.discussionPost.create({
        data: {
          threadId: thread.id,
          authorId: faculty.id,
          body: 'Yes — state space including the recursion stack, e.g. O(n) for naive recursion.',
          createdAt: at('2026-11-17T12:10:00Z'),
        },
      });
      await prisma.discussionThread.update({
        where: { id: thread.id },
        data: { answerPostId: answer.id },
      });
    }

    if (shared) {
      const directKey = [student.id, faculty.id].sort().join(':');
      const direct = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: student.id,
          lastMessageAt: at('2026-11-19T08:40:00Z'),
          participants: {
            create: [
              { userId: student.id, lastReadAt: at('2026-11-19T08:40:00Z') },
              { userId: faculty.id, lastReadAt: at('2026-11-19T07:00:00Z') },
            ],
          },
        },
      });
      for (const [senderId, body, when] of [
        [
          student.id,
          'Could I meet you during office hours on Thursday about the project topic?',
          '2026-11-19T06:55:00Z',
        ],
        [faculty.id, 'Sure — come by at 15:00.', '2026-11-19T07:30:00Z'],
        [student.id, 'Thank you, see you then.', '2026-11-19T08:40:00Z'],
      ] as const)
        await prisma.message.create({
          data: { conversationId: direct.id, senderId, body, createdAt: at(when) },
        });
    }
  }

  // Announcements beyond sections (FR-COMM-008), already delivered.
  const announcements = [
    {
      authorId: uniAdmin.id,
      title: 'Spring 2027 registration is open',
      body: 'Registration for Spring 2027 opened on 18 November. Check your eligibility and register before 10 January.',
      priority: 'IMPORTANT' as const,
      pinned: true,
      publishedAt: at('2026-11-18T03:30:00Z'),
      audiences: [{ targetType: 'ALL_STUDENTS' as const }],
    },
    {
      authorId: uniAdmin.id,
      title: 'Grade submission window',
      body: 'Final grades for Fall 2026 are due within five days of each final examination.',
      priority: 'NORMAL' as const,
      pinned: false,
      publishedAt: at('2026-11-15T04:00:00Z'),
      audiences: [{ targetType: 'ALL_FACULTY' as const }],
    },
    ...(cs
      ? [
          {
            authorId: deptAdmin.id,
            title: 'Computer Science seminar series',
            body: 'This week: "Verified compilers in practice". Thursday 16:00, Block D auditorium.',
            priority: 'NORMAL' as const,
            pinned: false,
            publishedAt: at('2026-11-16T05:00:00Z'),
            audiences: [{ targetType: 'DEPARTMENT' as const, targetId: cs.id }],
          },
          {
            authorId: deptAdmin.id,
            title: 'Second-year project fair',
            body: 'Second-year CS students: the project fair is on 4 December. Teams of up to three.',
            priority: 'NORMAL' as const,
            pinned: false,
            publishedAt: at('2026-11-19T05:00:00Z'),
            audiences: [{ targetType: 'YEAR_OF_STUDY' as const, targetId: cs.id, targetValue: 2 }],
          },
        ]
      : []),
  ];
  for (const a of announcements)
    await prisma.announcement.create({
      data: {
        ...a,
        notifiedAt: a.publishedAt,
        audiences: { create: a.audiences },
      },
    });

  // Feedback and tickets (FR-COMM-012/013).
  await prisma.feedback.create({
    data: {
      submittedById: student.id,
      category: 'FACILITIES',
      subject: 'Lab machines in Block D are slow',
      description: 'Several machines in D-104 take minutes to start the IDE during lab sessions.',
      departmentId: cs?.id ?? null,
      priority: 'MEDIUM',
      status: 'UNDER_REVIEW',
      assigneeId: deptAdmin.id,
      createdAt: at('2026-11-12T08:00:00Z'),
      responses: {
        create: {
          authorId: deptAdmin.id,
          body: 'Thanks — IT is upgrading the D-104 machines over the winter break.',
          createdAt: at('2026-11-13T05:30:00Z'),
        },
      },
    },
  });
  const ticket = async (data: {
    ownerId: string;
    subject: string;
    description: string;
    category: 'REGISTRATION' | 'ACCOUNT' | 'ACADEMIC';
    status: 'OPEN' | 'RESOLVED';
    createdAt: string;
    reply?: string;
  }) => {
    const n = await nextSequence('ticket:2026');
    const created = at(data.createdAt);
    const resolvedAt =
      data.status === 'RESOLVED' ? new Date(created.getTime() + 26 * 3600_000) : null;
    await prisma.supportTicket.create({
      data: {
        ticketNumber: `TCK-2026-${String(n).padStart(6, '0')}`,
        ownerId: data.ownerId,
        departmentId: cs?.id ?? null,
        category: data.category,
        subject: data.subject,
        description: data.description,
        status: data.status,
        assigneeId: data.status === 'RESOLVED' ? deptAdmin.id : null,
        resolvedAt,
        createdAt: created,
        lastActivityAt: resolvedAt ?? created,
        events: {
          create: [
            { actorId: data.ownerId, type: 'CREATED', toValue: 'OPEN', createdAt: created },
            ...(resolvedAt
              ? [
                  {
                    actorId: deptAdmin.id,
                    type: 'STATUS_CHANGED' as const,
                    fromValue: 'OPEN',
                    toValue: 'RESOLVED',
                    createdAt: resolvedAt,
                  },
                ]
              : []),
          ],
        },
        responses: data.reply
          ? {
              create: {
                authorId: deptAdmin.id,
                body: data.reply,
                createdAt: resolvedAt ?? created,
              },
            }
          : undefined,
      },
    });
  };
  await ticket({
    ownerId: student.id,
    category: 'ACCOUNT',
    subject: 'Profile photo will not upload',
    description: 'Uploading a JPEG profile photo fails with an error every time.',
    status: 'RESOLVED',
    createdAt: '2026-11-16T09:00:00Z',
    reply: 'The photo was over 5 MB. A smaller image uploads fine — please try again.',
  });
  await ticket({
    ownerId: student.id,
    category: 'REGISTRATION',
    subject: 'Elective not shown for Spring 2027',
    description: 'CS-E elective sections do not appear in my catalog for Spring 2027.',
    status: 'OPEN',
    createdAt: '2026-11-19T10:00:00Z',
  });
  return { created: true };
}
