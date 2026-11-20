# Development Roadmap

**Current phase:** Phase 2 — Authentication and access control (**complete**, 2026-11-20)
**Next phase:** Phase 3 — University structure

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
- [x] Review and sign-off by the project owner (2026-11-20: approved with default answers to the open questions)

## Phase 1 — Project foundation
- [x] Root npm workspaces (`apps/api`, `apps/web`, `packages/shared`), `.nvmrc`, `.editorconfig`, Prettier, ESLint (flat config), strict `tsconfig.base.json`
- [x] `packages/shared`: response envelope types, error codes, pagination/sort query schemas (+ tests)
- [x] API skeleton: Zod env validation (production safety checks), Pino with redaction, `app.ts` middleware chain, error handler, `AppError` hierarchy, 404 handler, request IDs, `/api/v1/health/live|ready`
- [x] `defineRoute` helper: typed Zod validation, **mandatory access declaration**, automatic OpenAPI registration
- [x] Prisma 7 + pg adapter, init migration (`citext`, `pg_trgm`, `universities`), idempotent seed, public `GET /university/public`
- [x] Redis clients with fail-fast cache client; Redis rate limiter with in-memory insurance; BullMQ queue factory; `worker.ts` with email + maintenance heartbeat
- [x] Storage interface + S3 driver + local signed-URL driver (dev)
- [x] Mailer (SMTP or log transport)
- [x] OpenAPI 3.1 generation + Swagger UI at `/api/docs` (disabled in production)
- [x] Socket.IO server with Redis adapter (handshake rejects all clients until Phase 2 auth)
- [x] Web skeleton: Vite + React 19 + TS, Tailwind 4 design tokens (light/dark), shadcn/ui, router with lazy routes and error boundary, TanStack Query, Axios client with `ApiError` normalization, theme store, shared states (empty/error/loading), status badge, 404/403 pages, live system-status page
- [x] Vitest (shared 6, API 31 incl. DB/Redis/BullMQ/Socket.IO integration, web 9 with MSW), Playwright smoke (6 runs: desktop + mobile)
- [x] `docker-compose.yml` (postgres, redis, minio, mailpit + `app` profile), Dockerfiles (api/worker, web), `nginx.conf`
- [x] Native (no-Docker) dev path: Homebrew Redis + PostgreSQL 17 (documented in README)
- [x] `.env.example`, `.env.docker.example`, README setup instructions
- [x] CI workflow (GitHub Actions): lint, format, typecheck, tests, build, migrate+seed, E2E, audit; separate Docker image build job
- [x] Exit: `npm run dev` brings up shared+api+worker+web; readiness `ok`; typecheck, lint, format, unit/integration and E2E all green; compiled API boots with `NODE_ENV=production`

**Verified manually:** status page in browser (dark/light, 375 px mobile), 404 page, Swagger UI, worker heartbeat written to Redis, production build refuses example secrets and serves JSON logs with docs disabled.

**Not verified (no Docker on dev machine):** `docker compose` infra and `app` profile, image builds (CI job added; first run pending a push).

## Phase 2 — Authentication and access control
- [x] Models: User, Role (+ `scopeMode`), Permission, RolePermission, UserRole, Session, RefreshToken, AuthToken, LoginAttempt, AuditLog; partial unique indexes and checks
- [x] Permission constants and system role matrix in `@ucrams/shared`; idempotent RBAC catalogue sync (seed + `bootstrap:admin`)
- [x] Argon2id hashing (rehash on parameter change); password policy (length, common list, not email-derived); login; exponential lockout; login history; enumeration-safe responses with timing equalization
- [x] Access JWT (jose, HS256, `kid`-free rotation via previous secret) + refresh rotation + reuse detection (10 s grace) + CSRF double-submit + Origin check
- [x] `/auth/me`, logout, logout-all, sessions list/revoke, login history, change password
- [x] Invitation acceptance and forgot/reset password via the email queue (single-use hashed tokens)
- [x] Fail-closed Redis rate limiters on auth endpoints (hashed identifiers in keys)
- [x] `authenticate` with revoked-session check (Redis with DB fallback) and permissions-version check; `requirePermission`; scope helpers (`covers`, `assertInScope`, `scopeFilter`); default-deny test over every route
- [x] Relationship-scoped roles: faculty/student grants are `OWN` and never satisfy organisational checks (ADR-014)
- [x] RBAC API: roles, permissions, custom roles, permission editing, scoped role assignment with privilege-escalation guard, last-super-admin protection
- [x] Admin account security API: user sessions, login history, revoke all, unlock
- [x] Audit log service (transactional) + filtered audit API
- [x] Socket.IO handshake authentication (user rooms; worker emitter verified)
- [x] Web: login, forgot/reset password, accept invitation, no-access page; in-memory auth store; session restore on reload; single-flight refresh interceptor; guards (auth, portal, permission, public-only) with safe `next` redirects; portal layout (sidebar, mobile sheet, breadcrumbs, portal switcher, user menu); overview; account security; roles list/editor; audit log
- [x] Dev accounts seed (one per role except department admin, see below)
- [x] Tests: API 109 (auth flows, rotation/reuse, lockout, CSRF, reset/invite, RBAC matrix, escalation, OWN scope, default deny, audit, sockets), shared 15, web 31, E2E 22 (desktop + mobile)
- [x] Exit: security tests pass; manual sign-in per role verified in the browser

**Verified manually (browser):** login with deep link, session restore on reload, role permission edit → audit entry, sign-out, student blocked from admin pages, mobile layout (375 px) without horizontal overflow, mobile navigation sheet.

**Deferred, by design:**
- Scoped (school/department) role assignment returns "Unknown school/department" until those tables exist (Phase 3); the department-admin dev account is created then.
- User-level admin endpoints (sessions, unlock, role listing) require university-wide grants until users have departments (Phase 4).
- MFA (TOTP) remains a Should item; the model has `mfaEnabled`.
- Socket.IO client in the web app is added with real-time features (Phase 9).

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
_None known._

## Technical debt
| ID | Item | Plan |
|---|---|---|
| TD-001 | Root `overrides` pins `effect@3.22.5` under `@prisma/config` to fix GHSA-7589-6fvf-x4pw (ReDoS) in Prisma 7.10.1's CLI config loader; `npm ls` reports it as "invalid" | Remove when Prisma ships a patched release |
| TD-002 | Web entry chunk is ~610 kB (191 kB gzip); Vite warns above 500 kB | Split per portal with lazy routes + `manualChunks` once portals exist (Phase 2/7/8) |
| TD-003 | S3 presigned URLs use `S3_ENDPOINT`; inside Compose that is `http://minio:9000`, which browsers cannot reach | Add `S3_PUBLIC_ENDPOINT` for presigning when uploads land (Phase 4/7) |
| TD-004 | Docker Compose stack and images not yet exercised locally | First CI run builds images; full stack check in Phase 13 or when Docker is available |
| TD-005 | The `local` storage driver is allowed with `NODE_ENV=production` | Decide in Phase 13: refuse it, or support single-server deployments explicitly |
| TD-006 | If Redis is down while a session is revoked, the revocation is only in the DB; the session's access token stays valid until it expires (≤ 15 min) | Accept (documented), or add a short DB check fallback when Redis was recently unavailable (Phase 12 review) |
| TD-007 | `DataTable` is a simple server-driven table; column visibility, sorting UI and bulk actions (TanStack Table) arrive with the first large admin tables | Phase 3/4 |
| TD-008 | `seed --reset-roles` restores system role permissions without bumping holders' `permissionsVersion` (dev-only command) | Bump versions if the command is ever used outside development |
| TD-009 | The current shadcn CLI generates components that import `cn` from shadcn's own `cn` npm package. The project standardises on the local `@/lib/utils` helper (same clsx + tailwind-merge behaviour), so generated imports are rewritten and the package is not a dependency | Rewrite the import whenever adding shadcn components (or switch wholesale to the `cn` package) |

## Architectural decisions
See [ARCHITECTURE.md §15](ARCHITECTURE.md#15-architecture-decision-records-summary) (ADR-001 … ADR-013).

## Phase 1 implementation decisions
| Decision | Reason |
|---|---|
| TypeScript 6.0 (not 7.0) | `typescript-eslint` supports `<6.1`; TS 7 (native port) breaks linting |
| Prisma 7.10.1 (not the 8.0 RC tagged `latest`) | Stable release; Prisma 7 requires the `@prisma/adapter-pg` driver adapter and `prisma.config.ts` |
| `prisma` CLI is a runtime dependency of the API | `prisma migrate deploy` runs from the production image in the release step |
| Generated Prisma client is not committed (`src/generated/`) | Regenerated by `build`/`typecheck` scripts |
| Env vars `API_PORT`/`API_HOST` instead of `PORT`/`HOST` | Dev tooling exported `PORT=5173` and silently moved the API onto the web port |
| Health endpoints live under `/api/v1/health/*` | Single prefix for Nginx proxying and the Vite dev proxy |
| `defineRoute` refuses routes without an `access` declaration and registers OpenAPI paths | Default-deny groundwork (SECURITY.md §7) and docs that cannot drift; a test checks the manifest |
| Local filesystem storage driver with HMAC-signed URLs | Docker/MinIO unavailable locally; same `StorageService` interface as S3 |
| `MAIL_TRANSPORT=log` default | Works without Mailpit; `smtp` for real delivery |
| Readiness: DB + Redis required (`down` → 503), storage failure → `degraded` | Uploads failing shouldn't take the whole API out of rotation |
| Vite dev proxy for `/api` and `/socket.io` | Same-origin in development, matching Nginx in production; no CORS needed for the SPA |
| Root route renders a live system-status page | Phase 1 has no authentication; a real data-backed page instead of placeholder portals |

## Phase 2 implementation decisions
| Decision | Reason |
|---|---|
| Faculty and Student are RELATIONSHIP roles whose grants have scope `OWN` (ADR-014) | A GLOBAL-scoped faculty assignment must never let a lecturer manage every section; relationship permissions are only usable through module policies |
| Assigning a RELATIONSHIP role needs only `user:assign_roles` at the target scope | They confer no organisational power, so the permission-subset guard (which would stop admins from assigning teaching roles) does not apply |
| Super Administrator role permissions are immutable via the API | Prevents locking everyone out of RBAC administration |
| Login success is recorded in `login_attempts`, not the audit log; lockouts, resets, revocations and RBAC changes are audited | Keeps the audit log focused on security events and administrative changes |
| Refresh endpoint returns `SESSION_REVOKED` for any unusable token and clears cookies | One clear client behaviour: sign in again |
| Concurrent refreshes within 10 s share one rotation; a 401 arriving after a refresh retries with the newer token | Multiple tabs and parallel requests must not trigger reuse detection or extra rotations |
| The API waits up to 10 s for Redis before listening | The fail-fast cache client otherwise produced 503s from fail-closed auth limiters right after boot |
| Partial unique indexes on `user_roles` instead of `NULLS NOT DISTINCT` | Prisma ignores partial indexes in drift detection; it tried to drop the other form on every `migrate dev` |
| Session end reason (`signed-out` / `expired`) in the client auth store | Explicit sign-out goes to a clean `/login`; expiry keeps `next` and shows "Your session ended" |

## Changelog
- 2026-11-20 — Phase 2 complete: authentication, sessions, RBAC with relationship scopes, audit log, admin/faculty/student portal shells, 155 unit/integration + 22 E2E tests.
- 2026-11-20 — Phase 1 complete: monorepo, API foundation, worker, storage, mail, sockets, OpenAPI, web shell, tests (52 + 6 E2E), Docker/CI files.
- 2026-11-20 — Phase 0 deliverables created: SRS, Architecture, Database (ERD), API, Security, Testing, Roles & Permissions, Roadmap, README.
