import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, envelope, server } from '@/tests/msw-server';
import { makeMe, renderRoute, signInAs } from '@/tests/render';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const base = [
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json(envelope({ unread: 0 }))),
  http.get(`${API}/conversations/unread-count`, () => HttpResponse.json(envelope({ total: 1 }))),
];
const student = () =>
  makeMe({
    portals: ['student'],
    permissions: ['message:send', 'ticket:submit', 'feedback:submit'],
  });

const conversation = {
  id: id(1),
  type: 'DIRECT',
  title: 'Tanvi Mehta',
  subtitle: null,
  section: null,
  announcementOnly: false,
  muted: false,
  member: true,
  unread: 1,
  canPost: true,
  canModerate: false,
  lastMessage: {
    preview: 'See you at 3',
    sender: 'Tanvi Mehta',
    createdAt: '2026-11-19T08:00:00Z',
  },
  lastMessageAt: '2026-11-19T08:00:00Z',
  participants: [{ userId: id(2), name: 'Tanvi Mehta', role: 'MEMBER' }],
};
const message = (n: number, body: string, mine = false) => ({
  id: id(100 + n),
  conversationId: id(1),
  sender: mine ? { id: id(3), name: 'Me Student' } : { id: id(2), name: 'Tanvi Mehta' },
  body,
  deleted: false,
  editedAt: null,
  createdAt: `2026-11-19T08:0${n}:00Z`,
  mine,
  canEdit: mine,
  canDelete: mine,
  attachments: [],
});

describe('messaging (FR-COMM-001/005)', () => {
  it('opens a conversation, marks it read and sends a message', async () => {
    const sent: unknown[] = [];
    let read = 0;
    const thread = [message(1, 'Office hours at 3pm. Details: https://example.edu/oh')];
    server.use(
      ...base,
      http.get(`${API}/conversations`, () => HttpResponse.json(envelope([conversation]))),
      http.get(`${API}/conversations/:id`, () => HttpResponse.json(envelope(conversation))),
      http.get(`${API}/conversations/:id/messages`, () =>
        HttpResponse.json(envelope({ hasMore: false, items: thread })),
      ),
      http.post(`${API}/conversations/:id/read`, () => {
        read++;
        return HttpResponse.json(envelope({ unread: 0 }));
      }),
      http.post(`${API}/conversations/:id/messages`, async ({ request }) => {
        const body = (await request.json()) as { body: string };
        sent.push(body);
        thread.push(message(2, body.body, true));
        return HttpResponse.json(envelope(thread.at(-1)), { status: 201 });
      }),
    );
    signInAs(student());
    renderRoute(`/student/messages?c=${id(1)}`);

    const pane = await screen.findByRole('region', { name: 'Conversation' });
    expect(await within(pane).findByText(/Office hours at 3pm/)).toBeInTheDocument();
    // Links in messages are real anchors; the text itself is never rendered as HTML.
    expect(within(pane).getByRole('link', { name: 'https://example.edu/oh' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    );
    await waitFor(() => expect(read).toBeGreaterThan(0));

    await userEvent.type(within(pane).getByLabelText('Message'), 'Thank you!{Enter}');
    await waitFor(() => expect(sent).toEqual([{ body: 'Thank you!', fileIds: [] }]));
    expect(await within(pane).findByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Messages, 1 unread' })).toBeInTheDocument();
  });
});

const ticket = {
  id: id(10),
  ticketNumber: 'TCK-2026-000042',
  category: 'REGISTRATION',
  priority: 'MEDIUM',
  subject: 'Cannot add COM101',
  description: 'The register button does nothing.',
  status: 'RESOLVED',
  owner: { id: id(3), name: 'Me Student', email: 'me@test.edu' },
  mine: true,
  department: null,
  assignee: { id: id(4), name: 'Dana Admin' },
  resolvedAt: '2026-11-19T10:00:00Z',
  closedAt: null,
  reopenUntil: '2026-11-26T10:00:00Z',
  canManage: false,
  canReopen: true,
  canReply: false,
  lastActivityAt: '2026-11-19T10:00:00Z',
  createdAt: '2026-11-18T10:00:00Z',
  attachments: [],
  responses: [
    {
      id: id(11),
      body: 'Your hold was released.',
      internal: false,
      author: 'Dana Admin',
      fromOwner: false,
      attachments: [],
      createdAt: '2026-11-19T10:00:00Z',
    },
  ],
  events: [
    {
      id: id(12),
      type: 'CREATED',
      fromValue: null,
      toValue: 'OPEN',
      actor: 'Me Student',
      createdAt: '2026-11-18T10:00:00Z',
    },
  ],
};

describe('support tickets (FR-COMM-013/014)', () => {
  it('shows staff replies and lets the owner reopen a resolved ticket', async () => {
    let reopened = false;
    server.use(
      ...base,
      http.get(`${API}/tickets/:id`, () =>
        HttpResponse.json(
          envelope(
            reopened
              ? { ...ticket, status: 'OPEN', canReopen: false, canReply: true, reopenUntil: null }
              : ticket,
          ),
        ),
      ),
      http.post(`${API}/tickets/:id/reopen`, () => {
        reopened = true;
        return HttpResponse.json(
          envelope({ ...ticket, status: 'OPEN', canReopen: false, canReply: true }),
        );
      }),
    );
    signInAs(student());
    renderRoute(`/student/support/${id(10)}`);
    expect(await screen.findByText('Your hold was released.')).toBeInTheDocument();
    expect(screen.getByText('TCK-2026-000042')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByLabelText('Reply')).toBeInTheDocument();
    expect(screen.queryByText(/Internal note/)).not.toBeInTheDocument();
  });
});

describe('notification preferences (FR-NOTIF-004)', () => {
  it('locks mandatory channels and saves changes', async () => {
    const saved: unknown[] = [];
    const prefs = [
      {
        category: 'REGISTRATION',
        channels: [
          { channel: 'IN_APP', enabled: true, mandatory: true },
          { channel: 'EMAIL', enabled: true, mandatory: true },
        ],
      },
      {
        category: 'ANNOUNCEMENT',
        channels: [
          { channel: 'IN_APP', enabled: true, mandatory: false },
          { channel: 'EMAIL', enabled: false, mandatory: false },
        ],
      },
    ];
    server.use(
      ...base,
      http.get(`${API}/notifications/preferences`, () => HttpResponse.json(envelope(prefs))),
      http.put(`${API}/notifications/preferences`, async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json(envelope(prefs));
      }),
      http.get(`${API}/auth/sessions`, () => HttpResponse.json(envelope([]))),
      http.get(`${API}/auth/login-history`, () => HttpResponse.json(envelope([]))),
    );
    signInAs(student());
    renderRoute('/student/account');
    expect(
      await screen.findByRole('switch', { name: 'Registration: Email (always on)' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('switch', { name: 'Announcements: Email' }));
    await waitFor(() =>
      expect(saved).toEqual([
        { preferences: [{ category: 'ANNOUNCEMENT', channel: 'EMAIL', enabled: true }] },
      ]),
    );
  });
});
