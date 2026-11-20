# Testing Strategy

> Status: **design (Phase 0)**. Test infrastructure is set up in Phase 1; each later phase adds tests for its own scope before it is marked done.

## 1. Pyramid and tools

| Layer | Tool | Scope | Runs against |
|---|---|---|---|
| Unit | Vitest | Pure logic: registration rules, time-overlap, prerequisite evaluation, GPA, progress calculation, permission resolution, mappers, Zod schemas | No I/O |
| Integration (API) | Vitest + Supertest | HTTP → middleware → services → real PostgreSQL + Redis | Dedicated test database (`ucrams_test`), Redis DB 15 |
| Concurrency | Vitest + Supertest / direct service calls with `Promise.all` | Seat races, double submit, waitlist promotion races, refresh-token races | Real PostgreSQL (row locks must be real) |
| Worker | Vitest | Job processors invoked directly + one end-to-end path through BullMQ | Real Redis |
| Socket | Vitest + `socket.io-client` | Auth handshake, room authorization, message/notification delivery | Running test server |
| Frontend unit/component | Vitest + React Testing Library + MSW | Forms, guards, tables, hooks | jsdom |
| End-to-end | Playwright | Critical user journeys across portals | Full stack (compose or local), seeded fixture data |

## 2. Test data

- **Factories** (`tests/factories/*.ts`) build minimal valid entities via Prisma: `createStudent({ program, year })`, `createSection({ capacity: 1, meetings: [...] })`, etc.
- **Isolation**: integration tests truncate all tables between test files (`TRUNCATE … RESTART IDENTITY CASCADE` using a generated table list); within a file each test creates its own entities with unique codes. Tests never depend on seed data.
- **E2E**: a dedicated `seed:e2e` script creates a small deterministic dataset; each Playwright spec creates the extra entities it needs through the API (fast setup) and only drives the UI for the behaviour under test.
- **Time**: services take a `Clock` dependency so deadline logic can be tested with fixed times.

## 3. Mandatory coverage by area (requirement IDs in parentheses)

### Authentication (FR-AUTH-*)
- Login success/failure; generic error for unknown email; timing-equalized path executed.
- Lockout after N failures; unlock after time; admin unlock.
- Refresh rotation: old token invalid after use; reuse after grace → session revoked (AC-AUTH-001); concurrent refresh within grace succeeds.
- Logout current / all; revoked session's access token rejected before expiry.
- Forgot/reset: identical responses (AC-AUTH-003); token single use; expiry; sessions revoked after reset.
- Rate limits return 429 with `Retry-After`.

### Authorization (FR-RBAC-*)
- Default-deny test: every route has a permission declaration or is explicitly public.
- Matrix test: for each protected endpoint, a table-driven test with each role (allowed/denied).
- Scope: department admin cannot read/update other departments' courses (AC-RBAC-001).
- Relationship: faculty cannot read roster of a section they don't teach (AC-RBAC-002); student cannot read another student's registrations.
- Role-assignment escalation guard.

### Registration engine (FR-REG-*)
- Each rule: pass and fail cases, with error code and details.
- Prerequisite groups (AND of OR), minimum grade, in-progress policy.
- Corequisites: same-session registration satisfies; batch pair; drop blocked (FR-REG-019).
- Credit limit incl. pending and policy for waitlisted.
- Timetable conflict: overlap, back-to-back allowed, different days, non-overlapping session date ranges.
- **Concurrency**: 50 students × capacity 1 → exactly 1 seat (AC-REG-001); one student submitting two conflicting sections concurrently → only one succeeds; same idempotency key twice → one row (AC-REG-006); drop + register race on a full section.
- Waitlist: join, positions, leave, promotion order, skip ineligible, offer mode with expiry, sweeper reconciles, section cancellation.
- Status transitions: invalid transitions rejected (e.g. withdraw a DROPPED registration).
- Counter invariants checked after every concurrency test (`enrolled_count` == count of seat-holding rows).

### Catalog and structure
- CRUD happy paths and unique-code conflicts.
- Deactivate vs delete rules.
- Prerequisite cycle detection.
- Capacity cannot go below enrollment; capacity increase triggers promotion.
- Classroom and instructor conflict detection.

### Communication
- Messaging permission rules (AC-COMM-001), section conversation membership sync.
- Announcement targeting resolution (AC-COMM-002), scope enforcement on publish, scheduled publication job.
- Notifications created on registration events; real-time delivery via socket.
- Ticket lifecycle; internal notes hidden from owner.

### Validation
- Each endpoint rejects malformed input with `VALIDATION_ERROR` and field paths (schema tests are generated from shared Zod schemas where possible).

### Frontend
- Login form validation and error display; redirect by role.
- Route guards: unauthenticated → login; unauthorized → home portal.
- Registration flow components: eligibility preview rendering, error-code → message mapping, confirmation.
- DataTable: sorting/pagination/filter state → query params.
- Notification bell updates on socket event.

## 4. End-to-end journeys (Playwright)

1. Admin creates a department.
2. Admin creates a degree program.
3. Admin creates a specialization.
4. Admin creates a course.
5. Admin creates a section.
6. Admin assigns faculty.
7. Admin creates a student.
8. Student logs in.
9. Student browses the catalog.
10. Student registers for the course.
11. Faculty logs in.
12. Faculty sees the student on the roster.
13. Faculty sends a section announcement.
14. Student sees the announcement.
15. Student submits a support ticket.
16. Admin responds to the ticket; student sees the reply.

Plus: waitlist promotion journey (two students, capacity 1, drop → promotion visible to second student); session management journey (log in twice, revoke the other session).

Viewports: desktop 1440×900 and mobile 390×844 for student journeys.

## 5. Commands (planned, Phase 1)

| Command | Purpose |
|---|---|
| `npm test` | All unit + integration tests across workspaces |
| `npm run test:api` | API unit + integration |
| `npm run test:web` | Frontend unit/component |
| `npm run test:e2e` | Playwright (expects stack running) |
| `npm run typecheck` | `tsc --noEmit` across workspaces |
| `npm run lint` | ESLint |

## 6. CI pipeline (planned)

1. Install (npm ci) → 2. Lint → 3. Typecheck → 4. Start Postgres + Redis services → 5. `prisma migrate deploy` on test DB → 6. API tests → 7. Web tests → 8. Build → 9. E2E against built stack → 10. `npm audit --audit-level=high`.

## 7. Phase exit criteria

A phase is done only when: its tests pass locally, typecheck and lint are clean, migrations apply from scratch, the affected flows were exercised manually in the running app, and docs/roadmap are updated.
