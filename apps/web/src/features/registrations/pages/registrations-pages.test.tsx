import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const page = <T,>(data: T[]) => ({
  success: true,
  message: 'OK',
  data,
  meta: { page: 1, limit: 25, total: data.length, totalPages: 1 },
});
const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const registration = (n: number, status = 'PENDING') => ({
  id: id(n),
  status,
  credits: 3,
  student: {
    id: id(100 + n),
    studentNumber: `25CS000${n}`,
    name: `Student ${n}`,
    email: `s${n}@test.edu`,
    yearOfStudy: 3,
    program: { code: 'BTECH-CS', name: 'B.Tech CS' },
  },
  course: { id: id(200), code: 'ME301', title: 'Fluid Mechanics', credits: 3 },
  section: { id: id(300), sectionCode: 'A', status: 'PUBLISHED', meetings: [], instructor: null },
  session: { id: id(400), code: 'SPRING-2027', name: 'Spring 2027' },
  waitlistedAt: null,
  offerExpiresAt: null,
  registeredAt: null,
  endedAt: null,
  overrides: [],
  overrideReason: null,
  pendingRequest: null,
  createdAt: '2026-11-19T09:30:00Z',
});
const base = [
  http.get(`${API}/academic-sessions`, () => HttpResponse.json(envelope([]))),
  http.get(`${API}/departments`, () => HttpResponse.json(page([]))),
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json(envelope({ unread: 0 }))),
];

describe('RegistrationsPage approvals', () => {
  it('approves selected pending registrations in bulk', async () => {
    let body: unknown;
    server.use(
      ...base,
      http.get(`${API}/registrations`, () =>
        HttpResponse.json(page([registration(1), registration(2)])),
      ),
      http.post(`${API}/registrations/bulk-decision`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(envelope({ succeeded: 2, failed: 0, results: [] }));
      }),
    );
    signInAs(
      makeMe({
        portals: ['admin'],
        permissions: ['dashboard:admin', 'registration:read', 'registration:approve'],
      }),
    );
    renderRoute('/admin/registrations?tab=approvals');

    expect(await screen.findByText('Student 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
    await waitFor(() =>
      expect(body).toEqual({ ids: [id(1), id(2)], decision: 'APPROVE', note: null }),
    );
    expect(await screen.findByText('2 approved')).toBeInTheDocument();
  });
});

describe('Register on behalf', () => {
  it('shows each rule and sends only the ticked overrides with a reason (FR-ADMIN-022)', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      ...base,
      http.get(`${API}/registrations`, () => HttpResponse.json(page([]))),
      http.get(`${API}/students`, () =>
        HttpResponse.json(
          page([
            {
              id: id(101),
              studentNumber: '25CS9001',
              firstName: 'Sara',
              lastName: 'Student',
              program: { code: 'BTECH-CS' },
              yearOfStudy: 2,
            },
          ]),
        ),
      ),
      http.get(`${API}/course-sections`, () =>
        HttpResponse.json(
          page([
            {
              id: id(300),
              sectionCode: 'A',
              course: { code: 'CS401', title: 'Machine Learning' },
              session: { name: 'Spring 2027' },
              enrolledCount: 3,
              capacity: 40,
            },
          ]),
        ),
      ),
      http.get(`${API}/registrations/eligibility`, () =>
        HttpResponse.json(
          envelope({
            sectionId: id(300),
            studentId: id(101),
            eligible: false,
            outcome: 'BLOCKED',
            rules: [
              {
                code: 'STUDENT_NOT_ACTIVE',
                passed: true,
                message: 'Student is active',
                details: null,
                overridable: null,
              },
              {
                code: 'PREREQUISITE_NOT_MET',
                passed: false,
                message: 'Missing prerequisites: CS301; MATH202',
                details: { missing: ['CS301', 'MATH202'] },
                overridable: 'PREREQUISITE',
              },
              {
                code: 'SECTION_FULL',
                passed: true,
                message: '37 seat(s) available',
                details: null,
                overridable: null,
              },
            ],
          }),
        ),
      ),
      http.post(`${API}/admin/registrations`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          envelope({
            ...registration(9, 'REGISTERED'),
            student: { ...registration(9).student, name: 'Sara Student' },
          }),
          { status: 201 },
        );
      }),
    );
    signInAs(
      makeMe({
        portals: ['admin'],
        permissions: [
          'dashboard:admin',
          'registration:read',
          'registration:manage',
          'registration:override',
        ],
      }),
    );
    renderRoute('/admin/registrations');

    await userEvent.click(await screen.findByRole('button', { name: /register a student/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Student' }));
    await userEvent.click(await screen.findByRole('option', { name: /Sara Student/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Section' }));
    await userEvent.click(await screen.findByRole('option', { name: /CS401 A/ }));

    expect(
      await within(dialog).findByText('Missing prerequisites: CS301; MATH202'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Override Prerequisites' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(await within(dialog).findByText(/Overrides need a reason/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('Reason'),
      'Approved by the head of department',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(body).toEqual({
        studentId: id(101),
        sectionId: id(300),
        joinWaitlist: false,
        overrides: ['PREREQUISITE'],
        reason: 'Approved by the head of department',
      }),
    );
  });
});
