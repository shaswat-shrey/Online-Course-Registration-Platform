# Development Roadmap

**Current phase:** Phase 0 — Product discovery and planning (deliverables complete, **awaiting review**)
**Next phase:** Phase 1 — Project foundation (starts after Phase 0 review)

Status legend: `[x]` done and verified · `[ ]` pending · `[~]` in progress

---

## Phase 0 — Product discovery and planning
- [x] Inspect working directory (empty git repo with remote `origin`; no commits)
- [x] Analyze requirements; list gaps, ambiguities and decisions (below)
- [x] Define academic hierarchy (SRS §4.3)
- [x] Define roles and permission matrix ([USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md))
- [x] Define modules, workflows, business rules, edge cases ([SRS.md](SRS.md))
- [x] Database design + ERD ([DATABASE.md](DATABASE.md))
- [x] API conventions ([API.md](API.md))
- [x] Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)), security ([SECURITY.md](SECURITY.md)), testing ([TESTING.md](TESTING.md))
- [x] Roadmap and phase task lists (this file)
- [ ] **Review and sign-off by the project owner** ← blocking Phase 1

## Phase 1 — Project foundation
- [ ] Root npm workspaces (`apps/api`, `apps/web`, `packages/shared`), `.nvmrc`, `.editorconfig`, Prettier, ESLint (flat config), strict `tsconfig.base.json`
- [ ] `packages/shared`: build setup, response envelope types, error codes, pagination schema, enums
- [ ] API skeleton: config (Zod env), Pino logger, `app.ts` middleware chain, error handler, `AppError` hierarchy, 404 handler, request IDs, `/health/live|ready`
- [ ] Prisma setup, initial migration (extensions: `citext`, `pg_trgm`), `University` model only to prove the pipeline
- [ ] Redis client(s) with graceful degradation; BullMQ queue factory; `worker.ts` boot with a no-op heartbeat job
- [ ] Storage service interface + S3 implementation + test implementation
- [ ] Mailer with Mailpit config
- [ ] OpenAPI generation + Swagger UI at `/api/docs`
- [ ] Socket.IO server bootstrap (auth handshake stub rejected until Phase 2)
- [ ] Web skeleton: Vite + React + TS, Tailwind, shadcn/ui init, router with portal layouts, TanStack Query provider, Axios client, theme tokens, 404/403 pages
- [ ] Vitest (api, web), Supertest, Playwright config; one smoke test each
- [ ] `docker-compose.yml` (postgres, redis, minio, mailpit) + Dockerfiles for api/worker/web + nginx.conf
- [ ] Native (no-Docker) dev path documented: Homebrew Redis + existing PostgreSQL 17
- [ ] `.env.example`, README setup instructions
- [ ] CI workflow (GitHub Actions): lint, typecheck, test
- [ ] Exit: `npm run dev` brings up api+worker+web; health ready; tests/typecheck/lint green

## Phase 2 — Authentication and access control
- [ ] Models: User, Role, Permission, RolePermission, UserRole, Session, RefreshToken, AuthToken, LoginAttempt, AuditLog
- [ ] Permission constants in shared; RBAC seed (system roles + matrix)
- [ ] Argon2id hashing; login; lockout; login history; enumeration-safe responses
- [ ] Access JWT (jose) + refresh rotation + reuse detection + CSRF double-submit
- [ ] `/auth/me`, logout, logout-all, sessions list/revoke, change password
- [ ] Invite/verify email, forgot/reset password (email queue)
- [ ] Redis rate limiters for auth endpoints
- [ ] `authenticate` middleware with revoked-session check; `requirePermission`; scope resolver; default-deny route test
- [ ] Audit log service + middleware helpers
- [ ] Web: login, forgot/reset, accept invite, auth store, refresh interceptor (single-flight), route guards, session management page
- [ ] Dev accounts seed (one per role)
- [ ] Tests: TESTING.md §3 Authentication + Authorization
- [ ] Exit: security tests pass; manual login per role works

## Phase 3 — University structure
- [ ] Models + APIs: University, Campus, School, Department, Degree, Program, Specialization, RequirementGroup, RequirementCourse (course FK added in Phase 5), AcademicYear, AcademicSession, SessionPolicy, RegistrationPeriod, PriorityWindow, GradingScale
- [ ] Scope-aware list filtering; deactivate vs delete
- [ ] Admin UI: CRUD pages with DataTable, forms, detail pages with stats
- [ ] Seed: schools, departments, degrees, programs, specializations (SRS / DATABASE §10), years, sessions, periods, example grading scales
- [ ] Tests: CRUD, uniqueness, scope

## Phase 4 — Student and faculty management
- [ ] Models: Student, StudentContact, StudentProgramHistory, RegistrationHold, FacultyMember, FacultySecondaryDepartment, AdminProfile
- [ ] APIs + admin UI for students/faculty/admins, status management, holds, program change
- [ ] Bulk import (CSV/XLSX) via `imports` queue with preview and per-row report
- [ ] Profiles (self-edit permitted fields), avatar upload (file service)
- [ ] Seed: faculty, students
- [ ] Tests

## Phase 5 — Course management
- [ ] Models: Course (+ outcomes, assessment components, FTS), prerequisites, corequisites, mappings, restrictions, Classroom, CourseSection, SectionMeeting, SectionInstructor
- [ ] Prerequisite cycle detection; classroom/instructor conflict detection; capacity rules; publish/close/cancel transitions; roll-forward
- [ ] Admin UI: course editor (prereq group builder), section editor (meeting grid, instructor picker, conflicts)
- [ ] Seed: courses, classrooms, sections
- [ ] Tests

## Phase 6 — Registration engine
- [ ] Models: CourseRegistration, RegistrationEvent, RegistrationRequest, AcademicRecord (minimal), CoursePlan/Item
- [ ] Rule pipeline + eligibility preview
- [ ] Register (locking, idempotency), batch, drop, withdraw, cancel, approve/reject, admin overrides
- [ ] Waitlist join/leave/promotion (auto + offer), sweeper, expiry at period close
- [ ] Notifications hooks (in-app; uses Phase 9 model early — minimal Notification model introduced here)
- [ ] Concurrency test suite; counter reconciliation job
- [ ] Seed: historical records, registrations, waitlists
- [ ] Exit: AC-REG-001..006 pass

## Phase 7 — Faculty portal
- [ ] Dashboard, profile, assignments, course workspace, roster (+export), schedule, materials (file service), section announcements, messaging entry points, feedback/ticket entry points
- [ ] Tests + E2E steps 11–13

## Phase 8 — Student portal
- [ ] Dashboard, catalog search, course detail with eligibility, registration flow, planner, registered courses, waitlist, timetable, progress, history, notifications, profile
- [ ] Mobile layouts
- [ ] Tests + E2E steps 8–10, 14

## Phase 9 — Communication system
- [ ] Conversations, messages, attachments, read receipts, unread counts, search, Socket.IO delivery
- [ ] Section conversations and discussions
- [ ] Announcements (audiences, scheduling, pin, expiry, read tracking), fan-out
- [ ] Notifications (preferences, email channel), feedback, tickets
- [ ] Tests + E2E steps 15–16

## Phase 10 — Academic management
- [ ] Timetables (faculty, classroom views), classroom availability
- [ ] Attendance, assessments, final grade submission/approval/posting, grade changes, GPA, transcripts
- [ ] Tests

## Phase 11 — Analytics and reporting
- [ ] Admin dashboard aggregates (cached), department analytics, report center (15 reports), CSV/XLSX exports (sync + background)
- [ ] Tests (dashboard totals match DB — AC-ADMIN-001)

## Phase 12 — Testing and security review
- [ ] Coverage gaps, full E2E suite, permission matrix tests, concurrency, OWASP review, load test of registration (k6, S)
- [ ] Fix all findings

## Phase 13 — Finalization
- [ ] Production compose profile, deployment guide, migration and backup procedures, monitoring, health checks, production checklist, docs consistency pass

---

## Requirement gaps and ambiguities identified (with decisions)

| # | Gap / ambiguity in the brief | Decision (changeable on review) |
|---|---|---|
| G-01 | "Faculty" means both an org unit and a teacher | `School` (org unit, UI label "Faculty / School") vs `FacultyMember` (person) — ADR-003 |
| G-02 | "Academic session" vs "semester" vs "term" | `AcademicYear` → `AcademicSession` (a term of any type). UI says "Session / Semester" |
| G-03 | "Approved" vs "Registered" statuses | Approval is an event; `PENDING → REGISTERED` — ADR-007 |
| G-04 | Does a PENDING registration hold a seat? | Yes, to avoid approving into a full section |
| G-05 | Withdrawal vs drop semantics | Drop before add/drop deadline (no record); withdraw after (W, no credits) |
| G-06 | Waitlist promotion: auto-enroll or offer? | Configurable per session; default auto-enroll |
| G-07 | Do waitlisted credits count toward the limit? | Configurable; default no |
| G-08 | Can students message each other? | Not via DMs initially; section discussions only |
| G-09 | Student → admin messaging target | Shared "Support inbox" conversation, not individual admins |
| G-10 | Grading policy | No default; example scales in seed clearly labelled as examples |
| G-11 | Self-registration of accounts | Disabled; admin-provisioned with invite emails |
| G-12 | Single vs multi-university | Single tenant (A-01) |
| G-13 | Time zone of deadlines | One configured university time zone |
| G-14 | Program requirements representation | Requirement groups (ALL_OF, CREDITS_FROM_LIST, CREDITS_FROM_CATEGORY, CREDITS_ANY) |
| G-15 | Fees/billing interplay with registration | Out of scope; FINANCIAL hold type allows manual blocking |
| G-16 | Section-level vs course-level restrictions | Both supported; section overrides course |
| G-17 | HOD as role or field | Field; admin rights via scoped `DEPARTMENT_ADMIN` |
| G-18 | Attendance/assessments/grades depth | Foundational working modules (Should), not full LMS |
| G-19 | Docker unavailable on dev machine | Support native PostgreSQL + Redis (Homebrew) for local dev; Docker for CI/prod — ADR-013 |

## Open questions for the project owner

1. Is the single-tenant assumption (one university per deployment) acceptable?
2. Default waitlist mode: auto-enroll (current default) or seat offer with claim window?
3. Should faculty be allowed to message any student, or only students in their sections (current design)?
4. Do you want MFA (TOTP) enforced for admin roles in the initial release, or MFA-ready only (current plan: optional, Should)?
5. Which grading scale(s) should seed data demonstrate (10-point CGPA, 4.0 letter, or both — current plan: both, labelled as examples)?
6. OK to install Redis via Homebrew for local development (Docker is not installed)? Alternatively install Docker Desktop/OrbStack to use the compose setup.

## Known bugs
_None (no code yet)._

## Technical debt
_None yet._

## Architectural decisions
See [ARCHITECTURE.md §15](ARCHITECTURE.md#15-architecture-decision-records-summary) (ADR-001 … ADR-013).

## Changelog
- 2026-11-20 — Phase 0 deliverables created: SRS, Architecture, Database (ERD), API, Security, Testing, Roles & Permissions, Roadmap, README.
