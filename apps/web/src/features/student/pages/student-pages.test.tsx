import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const session = {
  id: id(1),
  code: 'SPRING-2027',
  name: 'Spring 2027',
  status: 'PLANNED',
  startDate: '2027-01-11',
  endDate: '2027-05-21',
  registrationState: 'OPEN',
  period: {
    opensAt: '2026-11-18T03:30:00Z',
    closesAt: '2027-01-10T18:29:00Z',
    lateClosesAt: null,
    addDropDeadline: '2027-01-24T18:29:00Z',
    withdrawalDeadline: '2027-04-16T18:29:00Z',
  },
};
const section = {
  id: id(2),
  sectionCode: 'A',
  course: {
    id: id(3),
    code: 'CS301',
    title: 'Algorithms',
    credits: 4,
    status: 'ACTIVE',
    category: 'CORE',
    department: { id: id(4), code: 'CS', name: 'Computer Science' },
  },
  session: { ...session, startDate: '2027-01-11', endDate: '2027-05-21' },
  campus: null,
  capacity: 40,
  enrolledCount: 3,
  availableSeats: 37,
  waitlistCapacity: 10,
  waitlistCount: 0,
  status: 'PUBLISHED',
  registrationOpen: true,
  notes: null,
  publishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  scheduleOverrideReason: null,
  meetings: [
    {
      id: id(5),
      dayOfWeek: 1,
      startMinute: 660,
      endMinute: 720,
      type: 'LECTURE',
      classroom: { id: id(6), label: 'Block D D-104', capacity: 40 },
    },
  ],
  instructors: [
    {
      facultyMemberId: id(7),
      name: 'Tanvi Mehta',
      email: 't@test.edu',
      designation: 'PROFESSOR',
      role: 'PRIMARY',
    },
  ],
  hasRestrictions: false,
  permissions: {
    update: false,
    publish: false,
    cancel: false,
    assignFaculty: false,
    overrideConflicts: false,
  },
};
const course = {
  id: id(3),
  code: 'CS301',
  title: 'Design and Analysis of Algorithms',
  description: 'Greedy and dynamic programming.',
  syllabus: null,
  credits: 4,
  level: 300,
  category: 'CORE',
  department: { id: id(4), code: 'CS', name: 'Computer Science' },
  isRepeatable: false,
  inMyProgram: 'CORE',
  outcomes: [],
  assessmentComponents: [],
  prerequisites: [
    {
      items: [
        {
          course: { id: id(8), code: 'CS201', title: 'Data Structures' },
          minGradeLetter: null,
          state: 'IN_PROGRESS',
          grade: null,
        },
      ],
    },
  ],
  corequisites: [],
  hasRestrictions: false,
  completed: false,
  myRegistration: null,
  sections: [section],
};
const base = [
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json(envelope({ unread: 0 }))),
  http.get(`${API}/catalog/sessions`, () => HttpResponse.json(envelope([session]))),
];
const student = () => makeMe({ portals: ['student'], permissions: ['registration:self'] });

describe('student registration', () => {
  it('previews eligibility and registers with an idempotency key (FR-STUDENT-004/005)', async () => {
    const keys: string[] = [];
    server.use(
      ...base,
      http.get(`${API}/catalog/courses/:id`, () => HttpResponse.json(envelope(course))),
      http.get(`${API}/registrations/eligibility`, () =>
        HttpResponse.json(
          envelope({
            sectionId: id(2),
            studentId: id(9),
            eligible: true,
            outcome: 'REGISTER',
            rules: [
              {
                code: 'PREREQUISITE_NOT_MET',
                passed: true,
                message: 'Prerequisites met',
                details: null,
                overridable: null,
              },
            ],
          }),
        ),
      ),
      http.post(`${API}/registrations`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        return HttpResponse.json(
          envelope({ id: id(10), status: 'REGISTERED', waitlistPosition: null }),
          { status: 201 },
        );
      }),
    );
    signInAs(student());
    renderRoute(`/student/catalog/${id(3)}?sessionId=${id(1)}`);

    expect(await screen.findByText('In progress')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check & register' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('You can register for this section.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Registered in CS301 A')).toBeInTheDocument();
  });

  it('shows degree progress by requirement group (FR-STUDENT-009)', async () => {
    server.use(
      ...base,
      http.get(`${API}/students/me/progress`, () =>
        HttpResponse.json(
          envelope({
            program: { code: 'BTECH-CS', name: 'B.Tech in Computer Science' },
            specialization: null,
            totalRequired: 160,
            completed: 6,
            inProgress: 12,
            remaining: 142,
            groups: [
              {
                id: id(11),
                name: 'Programme core',
                kind: 'ALL_OF',
                category: null,
                source: 'PROGRAM',
                requiredCredits: 20,
                completedCredits: 6,
                inProgressCredits: 12,
                satisfied: false,
                courses: [
                  {
                    id: id(12),
                    code: 'CS101',
                    title: 'Programming Fundamentals',
                    credits: 4,
                    state: 'COMPLETED',
                  },
                  {
                    id: id(13),
                    code: 'CS204',
                    title: 'Data Structures Laboratory',
                    credits: 2,
                    state: 'PENDING',
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    signInAs(student());
    renderRoute('/student/progress');
    expect(await screen.findByText('Programme core')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: '6 of 160 credits completed, 12 in progress' }),
    ).toBeInTheDocument();
    expect(screen.getByText('To do')).toBeInTheDocument();
  });
});
