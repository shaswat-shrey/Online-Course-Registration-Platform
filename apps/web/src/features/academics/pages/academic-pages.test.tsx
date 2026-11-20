import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const base = [
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json(envelope({ unread: 0 }))),
  http.get(`${API}/conversations/unread-count`, () => HttpResponse.json(envelope({ total: 0 }))),
];

const sheet = (status: string, gradeLetter: string | null) => ({
  section: { id: id(1), label: 'CS101 A', title: 'Programming Fundamentals' },
  scale: {
    name: 'Ten-point',
    bands: [
      { letter: 'A', minPercent: 85, gradePoints: 10, isPassing: true, countsInGpa: true },
      { letter: 'B', minPercent: 70, gradePoints: 8, isPassing: true, countsInGpa: true },
      { letter: 'F', minPercent: 0, gradePoints: 0, isPassing: false, countsInGpa: true },
    ],
  },
  status,
  submittedBy: status === 'SUBMITTED' ? 'Tanvi Mehta' : null,
  submittedAt: status === 'SUBMITTED' ? '2026-12-20T10:00:00Z' : null,
  decidedBy: null,
  decidedAt: null,
  returnReason: null,
  postedAt: null,
  assessmentWeight: 100,
  canEdit: status === 'DRAFT',
  canDecide: status === 'SUBMITTED',
  students: [
    {
      registrationId: id(2),
      studentId: id(3),
      studentNumber: '25CS9001',
      name: 'Sara Student',
      registrationStatus: 'REGISTERED',
      percent: 88.5,
      suggested: 'A',
      gradeLetter,
      posted: false,
    },
  ],
});

describe('final grades (FR-ACAD-006)', () => {
  it('lets the primary instructor fill in suggested grades, save and submit', async () => {
    let current = sheet('DRAFT', null);
    const saved: unknown[] = [];
    server.use(
      ...base,
      http.get(`${API}/course-sections/:id/workspace`, () => HttpResponse.error()),
      http.get(`${API}/course-sections/:id/final-grades`, () =>
        HttpResponse.json(envelope(current)),
      ),
      http.put(`${API}/course-sections/:id/final-grades`, async ({ request }) => {
        saved.push(await request.json());
        current = sheet('DRAFT', 'A');
        return HttpResponse.json(envelope(current));
      }),
      http.post(`${API}/course-sections/:id/final-grades/submit`, () => {
        current = sheet('SUBMITTED', 'A');
        return HttpResponse.json(envelope(current));
      }),
    );
    signInAs(makeMe({ portals: ['admin'], permissions: ['grade:approve'] }));
    renderRoute(`/admin/grades/${id(1)}`);
    expect(await screen.findByText('Sara Student')).toBeInTheDocument();
    // An approver sees the sheet read-only while it is a draft.
    expect(screen.queryByRole('button', { name: 'Approve and post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Fill in suggested/ }));
    await userEvent.click(screen.getByRole('button', { name: /Submit for approval/ }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Submit' }),
    );
    await waitFor(() =>
      expect(saved).toEqual([{ grades: [{ registrationId: id(2), gradeLetter: 'A' }] }]),
    );
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve and post/ })).toBeInTheDocument();
  });
});

describe('transcript (FR-ACAD-007/008)', () => {
  it('shows grades by session with GPA, repeats and withdrawals', async () => {
    server.use(
      ...base,
      http.get(`${API}/students/me/transcript`, () =>
        HttpResponse.json(
          envelope({
            university: 'Northbridge University',
            repeatPolicy: 'LATEST',
            student: {
              id: id(3),
              studentNumber: '25CS9001',
              name: 'Sara Student',
              email: 's@test.edu',
              status: 'ACTIVE',
              program: { code: 'BTECH-CS', name: 'B.Tech in Computer Science' },
              department: 'Computer Science',
              school: 'Engineering',
              specialization: null,
              yearOfStudy: 2,
            },
            sessions: [
              {
                id: id(4),
                name: 'Fall 2025',
                credits: 4,
                gpa: 8,
                courses: [
                  {
                    recordId: id(5),
                    courseId: id(6),
                    code: 'CS101',
                    title: 'Programming Fundamentals',
                    credits: 4,
                    creditsEarned: 4,
                    grade: 'B',
                    gradePoints: 8,
                    passed: true,
                    source: 'ENROLLMENT',
                    repeatedLater: true,
                    version: 2,
                  },
                  {
                    recordId: null,
                    courseId: id(7),
                    code: 'MA101',
                    title: 'Calculus',
                    credits: 4,
                    creditsEarned: 0,
                    grade: 'W',
                    gradePoints: null,
                    passed: false,
                    source: 'ENROLLMENT',
                    repeatedLater: false,
                    version: 1,
                  },
                ],
              },
            ],
            creditsAttempted: 4,
            creditsEarned: 4,
            cgpa: 8,
            generatedAt: '2026-11-21T00:00:00Z',
          }),
        ),
      ),
    );
    signInAs(makeMe({ portals: ['student'], permissions: ['record:read'] }));
    renderRoute('/student/transcript');
    expect(await screen.findByRole('heading', { name: 'Sara Student' })).toBeInTheDocument();
    expect(screen.getByText(/GPA 8\.00/)).toBeInTheDocument();
    expect(screen.getByText('(not counted: repeated)')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText(/Only the latest attempt/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grade history/ })).not.toBeInTheDocument();
  });
});
