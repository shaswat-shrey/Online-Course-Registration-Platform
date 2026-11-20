# Development Roadmap

**Current phase:** Phase 8 — Student portal (**complete**, 2026-11-20)
**Status:** all phases complete (0–13).

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
- Socket.IO client in the web app is added with real-time features (Phase 9). ✅ Done in Phase 9.

## Phase 3 — University structure
- [x] Models: Campus, School, Department, Degree, Program, Specialization, RequirementGroup, AcademicYear, AcademicSession, SessionPolicy, RegistrationPeriod, PriorityWindow, GradingScale, GradeScaleEntry; CHECK constraints (dates, credits, owner XOR, period ordering, priority criteria), one current session per type (partial unique), trigram name indexes
- [x] Shared Zod input schemas (`@ucrams/shared/structure`) used by API and forms
- [x] APIs: university profile, campuses, schools, departments, degrees, programs, specializations, requirement groups, academic years, sessions (+ lifecycle transitions), policy, registration period, priority windows, grading scales
- [x] Scope-aware writes (department admins: own department only, no create/move; moving needs authority over both ends); reads open to signed-in users; `canManage` flags in list/detail responses
- [x] Deactivate vs delete rules (no deactivation with active children; delete only unreferenced; no creation under inactive parents); grading bands locked once a completed session uses the scale; program-level requirement credits within program total
- [x] Real scope resolver for SCHOOL/DEPARTMENT role assignments; department admin dev account (`cs.admin@ucrams.local`, CS)
- [x] Admin UI: university & campuses, faculties (list/detail), departments (list/detail), degrees, programs (list/detail with requirements and specializations), academic calendar (sessions/years), session detail (lifecycle, registration period in university time zone, policy, priority windows), grading scales editor; URL-synced search/filters/pagination; server field errors mapped onto form fields
- [x] Seed (idempotent): 9 faculties, 32 departments (all 12 engineering departments), 16 degrees, 32 programs, 33 specializations (Biology ×5, Arts ×10, Law ×8, CS ×3, BBA ×3, MBA ×4), 136 requirement groups, 2 academic years, 4 sessions with policies/periods/priority windows, 2 example grading scales
- [x] Tests: API +20 (181 total), shared +7 (22), web +8 (39, incl. time-zone helpers), E2E +6 (28 runs: create department → program → requirement → specialization and delete them; department-admin scope; time-zone display)

**Verified manually (browser):** programs list/detail with seeded data, session registration period shown in IST, client-side ordering validation, duplicate-code 409 mapped to the Code field, no horizontal overflow at 1024 px (fixed `SidebarInset` min-width bug found here).

**Deferred, by design:**
- Department head / faculty dean, and faculty/student/course counts on department pages, need faculty and student records (Phase 4) and courses (Phase 5).
- Course lists for `ALL_OF` / `CREDITS_FROM_LIST` requirement groups are attached in Phase 5 (`requirement_courses`).
- Notifying students when an active session's dates move (BR-020) arrives with notifications (Phase 9); the change is audited distinctly now (`session.active_dates_changed`).

## Phase 4 — Student and faculty management
- [x] Models: Student, StudentContact, StudentProgramHistory, RegistrationHold, FacultyMember, FacultySecondaryDepartment, AdminProfile, IdSequence, StoredFile, ImportJob, ImportJobRow; department head / school dean links; avatar on users; trigger keeping a student's specialization inside their program; CHECKs on year of study, graduation year, load credits and file size; partial index on active holds
- [x] APIs: students (scoped list/filters, detail with sensitive fields gated by `student:read_sensitive`, create with invitation, update, program change with history, status changes that suspend/deactivate the account, holds place/release), faculty (admin list, public directory, detail, create, update with head/dean guards), administrators (list/detail/create with escalation guard/update), account status (suspend/reactivate/deactivate, last super admin protected), resend invitation, self-service `/students/me` and `/faculty/me`
- [x] Generated identifiers: student numbers `YY + department code + 4 digits`, employee numbers `FAC00001`, from a concurrency-safe sequence table
- [x] Bulk import (CSV/XLSX, 5 MB / 5,000 rows) with header normalisation, per-row validation (format, codes, duplicates in file and database, admin scope), preview, commit through the `imports` queue (one transaction per row), optional invitations, per-row report, template download, cancel
- [x] File service: upload intents, signed local uploads, magic-byte type check (mismatches rejected and deleted), hourly purge of abandoned uploads; avatars for every user
- [x] User-level admin endpoints now scoped by the target's department (students and faculty), replacing the university-wide requirement
- [x] Web: students list (URL-synced filters) and detail (overview, contact, holds, program history, account & access), faculty list/detail, administrators list/detail, account card (suspend/reactivate/deactivate, resend invite, unlock, sign out everywhere), roles card (assign/revoke within scope), imports (upload → preview with problem rows → commit → live status), student and faculty profile pages (self-edit permitted fields), avatar upload, head/dean pickers and faculty/student counts on structure pages, "People" navigation
- [x] TD-010 resolved: `/auth/me` returns grant scopes per permission; create actions are hidden when no scope permits them
- [x] Seed (idempotent, deterministic): 129 faculty (32 heads, 9 deans), 1,669 students, ~20 holds; dev faculty/student accounts linked to records (`FAC09001`, `25CS9001`)
- [x] Tests: API +52 (233), shared +5 (27), web +5 (44), E2E +6 (34 runs: bulk import with an invalid row, department-admin scope, student profile edit)

**Verified manually (browser):** students list/detail with seeded data, CSV import preview → commit → worker-created account with the page polling to completion, department head picker (only active members of the department offered), faculty and administrator lists.

**Deferred, by design:**
- Deactivating a faculty member with section assignments is checked once sections exist (Phase 5).
- Import rows report format errors first; code lookups (program, department) run only once a row's format is valid, so a second upload can surface new problems.
- Student-number and employee-number formats are fixed; making them configurable is a settings item (Phase 12).

## Phase 5 — Course management
- [x] Models: Course (+ outcomes, assessment components, generated full-text `search_vector` with GIN and trigram indexes), PrerequisiteGroup/Item (AND of OR-groups with minimum grade), CourseCorequisite, CourseProgram, CourseSpecialization, CourseRestriction (course or section owner), RequirementCourse, Classroom, CourseSection, SectionMeeting, SectionInstructor; CHECKs (credits, level, enrollment, weights, capacity ≥ enrolled, meeting times/days, restriction owner/target) and one-primary-instructor partial unique index
- [x] Course API: ranked search (full text + code prefix + trigram), filters, status lifecycle (draft → active ⇄ inactive → archived, archive/restore need `course:archive`), scoped create/edit/move, delete of unreferenced drafts only, visibility (non-managers see active courses only)
- [x] Prerequisite cycle detection over the whole graph (BR-007) with the cycle path in the error; corequisite/prerequisite overlap rejected; program/specialization mappings; include/exclude restrictions on courses and sections; requirement-group course lists (deferred from Phase 3; drafts not allowed)
- [x] Classrooms: CRUD, duplicate-room guard, deactivation blocked while meetings are scheduled, weekly occupancy per session
- [x] Sections: create/edit (capacity never below enrollment, row-locked), weekly meetings and instructors with classroom/instructor conflict detection (BR-018), serialised per session with an advisory lock; overrides need a reason (room overrides also need `section:override_conflicts`) and are audited; load-limit and room-size warnings; lifecycle publish/close/reopen/cancel/complete with the primary-instructor rule (BR-014) and a publish-time conflict re-check; roll-forward into another session as drafts; faculty teaching schedule and load
- [x] Web: course catalog (search, filters), course detail (overview, prerequisite builder, corequisites, program/specialization mappings, restrictions, sections), sections list per session (defaults to the active session) and detail (meetings editor with room search, instructor assignment, conflict panel with override, lifecycle actions, week view), roll-forward dialog, classrooms list and weekly occupancy grid, requirement-group course lists on program pages; reusable async search picker and week grid
- [x] Seed (idempotent): 105 classrooms on two campuses, 272 courses (curated Computer Science and Mathematics catalogs, eight courses per other department) with prerequisites, lab corequisites, mappings and requirement-group lists; 602 conflict-free sections across Fall 2025, Spring 2026 (completed) and Fall 2026 (active); Spring 2027 left empty for roll-forward
- [x] Tests: API +44 (277), shared +9 (36), web +4 (48), E2E +4 (38 runs: course → section → meetings → instructor → publish → cancel → archive; department-admin edit scope)

**Verified manually (browser):** course search by topic, prerequisite builder rejecting a cycle with the path shown, section meetings conflict panel with override, classroom weekly occupancy, requirement-group course lists on a program.

**Deferred, by design:**
- Cancelling a section cancels registrations and waitlist entries and notifies people once registrations exist (Phase 6) and notifications exist (Phase 9); the section side is in place.
- Raising capacity promotes waitlisted students in Phase 6.
- Restrictions and prerequisite minimum grades are enforced by the registration engine (Phase 6).
- Faculty-portal views of a teaching schedule arrive with the faculty portal (Phase 7); the API endpoint exists.

## Phase 6 — Registration engine
- [x] Models: CourseRegistration (denormalised course/session kept equal to the section by a trigger; one active attempt per course and session by partial unique index; idempotency key unique per student), RegistrationEvent (append-only history), RegistrationRequest (withdrawal approval), AcademicRecord (minimal, source for prerequisites and CGPA), CoursePlan/Item, Notification
- [x] Rule pipeline as pure functions in SRS order: student status, holds, registration window (priority windows open earlier; late window needs approval), section availability, duplicate, already completed (unless repeatable), prerequisites (AND of OR-groups, minimum grade by scale order, in-progress courses per policy), corequisites (completed, registered, or in the same batch), restrictions (course + section, include/exclude), credit limit (waitlist per policy), timetable clash, seats/waitlist
- [x] Eligibility preview for students and administrators (every rule with its result and whether it can be overridden)
- [x] Submit: fail-fast pre-check outside locks, then student lock → section lock → re-check of seats, duplicates, credits, clashes and holds → insert + counter + history + notification in one transaction; deadlock retry; `Idempotency-Key` replays (`Idempotent-Replay: true`), key reuse for a different section → 409
- [x] Approval modes (none, all, cross-department, late only) with PENDING seats; approve/reject singly or in bulk; withdrawal requests when the policy requires approval
- [x] Drop (before add/drop; corequisite dependants must be dropped together), withdraw (after add/drop, before the withdrawal deadline), cancel a pending request, leave a waitlist, decline an offer
- [x] Administrative register/drop/withdraw on a student's behalf with per-rule overrides (period, capacity, prerequisite, corequisite, restriction, credit limit, timetable) that need `registration:override` and a reason, are stored on the registration and audited; capacity overrides raise capacity
- [x] Waitlist: join when full, ordered by time then id; promotion job per section (deduplicated) in auto-enroll or offer mode with claim window; ineligible candidates leave the list and are told why; offer expiry (delayed job and sweeper); all entries expire when the period closes; manual promotion
- [x] Section cancellation cascades to registrations and waitlists and notifies students and instructors; raising capacity or reopening registration triggers promotion
- [x] Worker: waitlist queue (promote, expire offer), 5-minute sweeper, hourly counter reconciliation, daily notification purge (180 days)
- [x] In-app notifications for every registration event with unread count, list and mark-read API; bell in all portals
- [x] Academic records read API with CGPA; course plans with validation and one-call registration
- [x] Web: registrations list (filters incl. overrides), approvals (bulk), withdrawal requests, registration detail with history and actions, register-on-behalf with live eligibility and override checkboxes, section registrations and ordered waitlist with promote/remove, student registrations and academic record tab, notifications bell
- [x] Seed: graded history for Fall 2025 and Spring 2026 (3,620 records), current Fall 2026 timetables (≈3,000 registrations), Spring 2027 open now with early registrations, full sections with waitlists and cross-department approvals
- [x] Tests: API +49 (325, incl. AC-REG-001 50-way race for one seat, AC-REG-006 concurrent idempotent submits, two clashing sections from one student at once, offer expiry, period-close expiry, counter drift), shared +3 (39), web +2 (50), E2E +2 (40 runs)
- [x] Exit: AC-REG-001..006 pass

**Verified manually (browser):** approvals list, register-on-behalf preview (in-progress prerequisites accepted per policy; missing prerequisites listed with the override offered; submit refused without it), section waitlist, capacity raise promoting two waitlisted students through the running worker with notifications.

**Found and fixed:** the Prisma pg adapter sent timestamps without an offset, so on a database server not running in UTC every stored instant was shifted (here by 5½ hours) while reads shifted back. The adapter now pins the session time zone to UTC; a regression test checks it; the dev database was corrected in place.

**Deferred, by design:**
- Student-facing registration screens (catalog, planner, timetable) arrive with the student portal (Phase 8); the API is complete.
- Email delivery of notifications, preferences and real-time socket delivery in the web client arrive with communication (Phase 9); notifications are stored and pushed to the user room now.
- `REGISTERED → COMPLETED` happens when final grades are posted (Phase 10); seeded history is already completed.
- Waitlist reordering by administrators (FR-ADMIN-023 "reorder with override") and the conflicts view (FR-ADMIN-024) are not built yet; registrations created with overrides are filterable.

## Phase 7 — Faculty portal
- [x] Models: SectionMaterial (file or link, folder, position, published), Announcement + AnnouncementAudience (section audiences now; more audience types in Phase 9)
- [x] Access through the instructor relationship (any instructor role) or an organisational grant covering the course's department; sections the caller has no relationship with return 404
- [x] Dashboard (FR-FACULTY-001): sections this session with fill, students taught, today's classes in the university time zone, weekly schedule, load vs limit, sections next session, recent announcements
- [x] Teaching assignments (current, upcoming, past) and course workspace (course content, schedule, class statistics by status, program and year)
- [x] Roster with search and status filter, academic-only student profile (no contact, address or holds), CSV export with formula neutralisation (audited)
- [x] Materials: uploads in a new MATERIAL context (PDF, Office, images, ZIP; 50 MB; content-sniffed), links, folders, publish/unpublish, delete (removes the stored file), signed downloads only for instructors, administrators in scope and registered students; MATERIAL uploads need `material:manage`
- [x] Section announcements to one or several of the author's running sections; enrolled students and co-instructors are notified; authors edit and delete their own
- [x] Web: faculty overview with the teaching dashboard, My teaching, section workspace (overview, roster with student sheet and export, materials, announcements), announcements page with composer
- [x] Seed: reading-list links and two announcements for the dev faculty account
- [x] Tests: API +22 (347), shared +2 (41), web +3 (53), E2E +2 (42 runs: journey steps 11–13)

**Verified manually (browser):** faculty dashboard with live data (today's classes on Friday in IST), roster and student sheet, file upload through intent → upload → content check → publish, deletion.

**Deferred, by design:**
- Messaging, section discussions, feedback and tickets (FR-FACULTY-009/010) arrive with communication (Phase 9); attendance, assessments and grade summaries on the roster with academics (Phase 10). Their navigation entries are not shown until they work.
- Announcement read tracking, scheduling and wider audiences arrive in Phase 9.


## Phase 8 — Student portal
- [x] API: catalog sessions with window state; catalog per session (active courses with published sections; search, department, category, level, credits, program, specialization, instructor, open-seat/waitlist availability, "in my program"; the student's own status per course); course page with personal prerequisite/corequisite status and the session's sections; dashboard; timetable and iCalendar export (weekly RRULE in the university zone); academic history with session GPA, CGPA and W entries; degree progress against program and specialization requirement groups; announcements feed
- [x] Registered students keep access to sections (and their materials and announcements) after the section closes or completes
- [x] Web: student overview with dashboard (profile summary, credits, degree progress, registration window and status, this session's courses, items waiting on approval/waitlist/offers, announcements), catalog with filters and deadline strip, course page with requirement chips and "Check & register" (eligibility preview, then register, request or join the waitlist with an idempotency key), my registrations (drop, withdraw, leave waitlist, cancel request, claim or decline an offer, according to deadlines), timetable (grid on desktop, day list on phones) with "Add to calendar", planner (plans per session, sections per course, rule check per item, register all), degree progress, academic history, announcements, a page per registered course (materials, announcements, schedule)
- [x] Faculty composer can also target next session's sections
- [x] Mobile layouts checked at 375 px (no horizontal overflow; badges no longer wrap)
- [x] Tests: API +14 (361), web +2 (55), E2E +2 (44 runs: journey steps 8–10 and 14 with a separate faculty session)

**Verified manually (browser):** student dashboard with live data, catalog and deadline strip in IST, course page with in-progress prerequisites, registration through the eligibility dialog, drop from My registrations, mobile timetable day list and progress page.

**Deferred, by design:**
- Messaging instructors and administration, section discussions, feedback and tickets (FR-STUDENT-012) arrive with communication (Phase 9).
- Grades appear in history once grading is posted (Phase 10); seeded history is graded already.

## Phase 9 — Communication system
- [x] Models: Conversation (DIRECT/SECTION/SUPPORT with type-key CHECK), ConversationParticipant (read pointer, mute, left), Message (generated `search_vector` + GIN), MessageAttachment, DiscussionThread/Post, AnnouncementAudience (all audience types, `target_value`, `role_filter`, target CHECK), AnnouncementRead, NotificationPreference, EmailLog, Feedback/FeedbackResponse, SupportTicket/TicketResponse/TicketEvent/TicketAttachment (number format and resolution CHECKs)
- [x] Messaging: contact rules (FR-COMM-002), direct conversations, a support conversation per user answered by administrators of their department, section conversations synced with the roster (instructors moderate, announcement-only mode), attachments, 15-minute edits, soft delete, unread counts, full-text search, Socket.IO delivery (`message:*`, `conversation:read`, `notification:new`)
- [x] Discussions per section: questions and discussions, replies, pin, lock, accepted answer, reply notifications
- [x] Announcements to every audience with scoped targeting (FR-COMM-011), scheduling on the `announcements` queue (rescheduled on edit; a minute sweep catches lost jobs), one-time fan-out, expiry, pin, read tracking, per-user feed
- [x] Notification preferences per category × channel with mandatory channels; email delivery for opted-in categories (urgent announcements always) through the email queue with an `email_logs` record per message
- [x] Feedback (categories, priority, status workflow, assignee, responses, anonymity) and support tickets (TCK-YYYY-000123 numbers, attachments, public replies and internal notes, status history, reopen within 7 days, hourly auto-close)
- [x] Web: real-time bridge (socket.io-client; cache invalidation and toasts), messages page with header unread badge, discussions (boards, thread page, workspace and course-page tabs), announcements feed for every portal plus admin composer with audience builder and scheduling, notification preferences on the account page, feedback and support pages for students and faculty, feedback and ticket queues for administrators
- [x] Seed: section chat, an answered discussion question, university/department/year announcements, feedback and two tickets for the dev accounts
- [x] Tests: API +10 (415), shared +4 (45), web +3 (58), E2E +4 (48 runs: journey steps 15–16 and the support inbox, each with a separate administrator session)

**Verified manually (browser):** section chat receiving an instructor's message in real time and replying, announcement feed with read state, support ticket list and resolved-ticket detail with reopen window.

**Deferred, by design:**
- Email digest mode (FR-NOTIF-006, priority S) — TD-020.
- Group conversations (the data model allows them; no UI or rules yet).
- Notifying students when an active session's dates move (BR-020) still waits on a session-change workflow (Phase 10 calendar work).

## Phase 10 — Academic management
- [x] Models: AttendanceSession, AttendanceRecord, Assessment, AssessmentScore, FinalGradeSubmission, FinalGradeEntry, GradeChange; `course_sections.attendance_enabled`, `universities.gpa_repeat_policy`; notification category `GRADES`; CHECKs on weights, scores, posting and versions
- [x] Timetables (FR-ACAD-001) were already built from section meetings (student, faculty, classroom, section); classroom free/busy per session with utilisation (FR-ACAD-002)
- [x] Attendance (FR-ACAD-003): per-section switch, class dates, Present/Absent/Late/Excused marks, percentages (excused not counted) on the register and roster (and its CSV), students' own record
- [x] Assessments (FR-ACAD-004): components with weights capped at 100 %, scores within the maximum or excused, publishing (notifies students), weighted gradebook from a shared `weightedPercent` rule
- [x] Final grades (FR-ACAD-006/007): primary instructor drafts (suggested letters from the session scale) and submits once weights total 100 %; administrators with `grade:approve` in scope return with a reason or approve, which posts academic records, completes registrations and notifies students and the instructor
- [x] Grade changes (FR-ACAD-006/009) by `grade:change` with a reason; versions kept in `grade_changes`
- [x] Transcripts and GPA (FR-ACAD-008) with a university-wide repeat policy (all / latest / best attempt); student history uses the same builder
- [x] Web: workspace tabs for attendance, assessments and final grades; student course tabs for assessments and attendance; transcript pages (student, and administrator with grade change and history); grade approval queue; room availability; repeat policy on the university page
- [x] Seed: six weeks of attendance and three assessments (two published, with scores) in the dev accounts' running sections
- [x] Fixed: wrapped tab bars on phones overlapped the content below them (tab list height now grows)
- [x] Tests: API +5 (443), shared +3 (48), web +2 (60), E2E +4 (52 runs: attendance, and grade submission returned by the department administrator)

**Verified manually (browser):** student assessments and attendance tabs with seeded data (weighted mark matches the rule), room availability grid, administrator transcript, grade approval queue.

**Deferred, by design:**
- Transfer credits and exemptions (`record:manage`) — TD-022.
- PDF transcripts: the transcript page prints cleanly from the browser; a signed PDF is a Phase 13 candidate.
- The E2E suite stops at "return" so it does not post grades permanently into the dev database; posting is covered by API tests.

## Phase 11 — Analytics and reporting
- [x] Model: ExportJob (format, params, status, row count, file; completion CHECK)
- [x] Administrator dashboard (FR-ADMIN-001..006): live counts, eight charts, widgets (pending approvals/tickets/feedback, recent users, recent audit) and alerts (failed jobs, stale worker heartbeat, sections below minimum enrollment, published sections without a primary instructor); filters for year, session, school, department, degree, programme, specialization and course; restricted to the caller's `dashboard:admin` scope; cached in Redis for 60 s per scope and filters, invalidated through a version key bumped on every registration event
- [x] Report center (FR-RPT-001/002): 15 reports (students, faculty, departments, programmes, specializations, course and section enrollment, registrations, capacity, faculty workload, academic performance, course completion, student credits, enrollment trends, incomplete registrations) with server-side filters, sorting and pagination, all scoped
- [x] Exports (FR-RPT-003/004): CSV (BOM, formula-safe) and XLSX (frozen bold header); up to 5,000 rows written immediately, larger exports on the `exports` queue re-run with the requester's current grants and notify on completion; audited; signed downloads for the requester only
- [x] Web: dashboard on the administrator overview (KPI tiles, single-hue charts with tooltips and a data table under each, alerts, widgets), report center, report runner with filters/sort/export, "My exports"
- [x] Fixed during the browser check: audit-log bigint ids broke the dashboard cache for administrators with audit access
- [x] Tests: API +4 (457 incl. AC-ADMIN-001), E2E +2 (54 runs)

**Verified manually (browser):** scoped department-admin dashboard (counts and charts), section enrollment report.

## Phase 12 — Testing and security review
- [x] Coverage measured (`npm run test:coverage -w @ucrams/api`); gaps closed for the course planner and academic records API, classrooms, the email outbox, every report, and the remaining announcement audiences. API line coverage 81 % → 84.9 % (entry points and the S3 driver excluded)
- [x] Permission matrix test: every permission-gated route answers 403 to every system role (and a role-less user) that lacks its permission — 588 cases — next to the existing default-deny test (anonymous → 401 on every protected route)
- [x] Concurrency tests: parallel ticket numbering, double grade approval, parallel announcement fan-out (registration seat races were already covered by AC-REG-001)
- [x] OWASP Top 10 review with three fixes ([SECURITY_REVIEW.md](SECURITY_REVIEW.md)): no student-id enumeration through records (SR-01), per-user limits on messages, posts, tickets, feedback and exports (SR-02), serialised grade approval (SR-03)
- [x] Dependency audit: 0 vulnerabilities
- [x] Load test script for registration (`load/registration.k6.js`, k6) — written, not executed here (k6 not installed); documented in TESTING.md
- [x] Full suites green: API 1,050 · shared 48 · web 60 · E2E 54 runs

## Phase 13 — Finalization
- [x] Production Compose profile fixed and hardened: the API now receives `JWT_ACCESS_SECRET` (it would not have started), secrets use Compose's required-variable syntax, `WEB_APP_URL`/`PUBLIC_API_URL`/`CORS_ORIGINS` come from one `PUBLIC_URL`, SMTP settings are configurable, app services restart automatically; the production environment was validated against the compiled config loader
- [x] First-administrator bootstrap compiled into the build (`dist/bootstrap-admin.js`), so it runs in the production image without dev tools; verified idempotent
- [x] Compiled API and worker booted from `dist/` with readiness `ok` (database, Redis, storage)
- [x] Deployment guide ([DEPLOYMENT.md](DEPLOYMENT.md)): processes, configuration, first deployment with and without Docker, upgrades and forward-only migrations, backups and a tested restore drill (`scripts/backup-db.sh`), health checks and monitoring signals, production checklist, capacity notes
- [x] Documentation consistency pass: status banners, stale "later phase" notes, README (features, prerequisites, setup from a fresh clone, Docker, bootstrap), API catalogue, TD-023 for designed-but-not-built endpoints
- [x] Fixed during final verification: a sender's read pointer used the client clock and could trail their own message's database time, which occasionally suppressed the "new reply" notification (regression test added); the E2E navigation helper now waits for the phone navigation sheet to settle
- [x] Final verification: typecheck, lint, format, production build, API 1,051 · shared 48 · web 60 unit/integration tests and 54 E2E runs (desktop + mobile), all passing

**Not verified (no Docker on the development machine):** `docker compose --profile app up` end to end; CI builds both images on every push.

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
_None known._ (Fixed in Phase 6: timestamps shifted by the database server's time zone; see Phase 6.)

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
| TD-010 | ~~"New department" shown to department-scoped admins~~ | **Resolved in Phase 4** (`grants` in `/auth/me`, `useCanAt`) |
| TD-016 | Idempotency is backed by the registration row (`student_id`, `idempotency_key`), so a replayed *failed* attempt is re-evaluated instead of returning the first error | Cache full responses in Redis for 24 h if clients need exact replays of failures |
| TD-017 | Waitlist reorder (FR-ADMIN-023) and the conflicts view (FR-ADMIN-024) | Add with the admin dashboard work (Phase 11) |
| TD-018 | Material ordering is by `position` within a folder but the UI has no drag-to-reorder yet | Add reordering with the student portal's materials view (Phase 8) |
| TD-020 | No daily email digest (FR-NOTIF-006, S); emails are sent per notification | Add a digest preference and a daily job batching opted-in categories |
| TD-021 | Section conversation membership is synced when the conversation list or the conversation is opened, or someone posts — not on every registration change | Event-driven sync from registration changes if read receipts per member become important |
| TD-023 | Not in this release: global search endpoint, runtime settings API, failed-job retry API, documents store (designed in API.md) | Add when needed; failed jobs are visible on the dashboard and retryable with BullMQ tooling |
| TD-022 | No UI/API for transfer credits and exemptions (`record:manage`); records support `source` TRANSFER/EXEMPTION | Add `POST /students/{id}/records` with an admin form |
| TD-019 | A student may register for a course they are currently taking in another (unfinished) session; FR-REG-007 only blocks courses already passed | Decide with the registrar whether to block concurrent repeats (Phase 12 review) |
| TD-013 | Section meetings run for the whole session (no per-meeting start/end dates) | Add `starts_on`/`ends_on` if half-session courses are needed |
| TD-014 | Syllabus is rich text only; no syllabus file attachment yet | Add with course materials (Phase 7, file service exists) |
| TD-015 | Room overlap is enforced in the service under a per-session advisory lock, not by a `btree_gist` exclusion constraint | Consider the constraint if schedules are ever written outside the API |
| TD-012 | `PUBLIC_API_URL` is `http://localhost:5173` in development so signed upload/download links go through the Vite proxy (same origin, needed by Helmet's CORP) | Production serves API and web behind one origin; revisit if they are split |
| TD-011 | Structure lists use offset pagination and `ILIKE` search backed by trigram indexes; adequate for hundreds of rows | Revisit with the course catalog (Phase 5), which needs full-text search |
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

## Phase 3 implementation decisions
| Decision | Reason |
|---|---|
| Schema validation → 400, database-dependent business validation → 422 (`VALIDATION_ERROR` with `details.fields`) | Clients can tell "malformed input" from "valid input the current data rejects" while forms still map both to fields |
| One registration period per session (`session_id` unique) | The SRS models one period per session; late registration is a window within it |
| Reads of structure and calendar are open to every signed-in user | Students and faculty need departments, programs and deadlines for catalog browsing and planning; nothing here is personal data |
| Registration-period instants stored in UTC, edited/displayed in the university time zone (not the browser's) | Deadlines are institutional (SRS A-05); admins elsewhere must see the same wall-clock times |
| Seed never overwrites existing rows | Edits made through the UI survive `db:seed` |
| Requirement-group PUT/DELETE declare `authenticated` access and check `program:manage` or `specialization:manage` in the service | The needed permission depends on the group's owner |

## Phase 4 implementation decisions
| Decision | Reason |
|---|---|
| University Admin now holds `material:manage` and `attendance:manage` (all Department Admin permissions) | The escalation guard only lets admins assign roles whose permissions they hold; University Admins must be able to provision department admins |
| Student/faculty records are separate tables linked 1:1 to `users` | Accounts (auth) and academic records have different lifecycles and visibility rules |
| Suspending a student suspends the account and revokes sessions; dismissal deactivates it; other statuses restore it | Academic status and sign-in ability must not drift apart |
| Contact details and hold reasons only for the student themself or `student:read_sensitive` | Least privilege for personal data (SECURITY.md §9) |
| Import commit runs in the worker, one transaction per row; invitations sent after the run | A bad row cannot roll back thousands of good ones; emails only for accounts that exist |
| BullMQ job ids use `-` (`import-{id}`) | BullMQ rejects custom ids containing `:` |
| Head of department must be an active primary or secondary member; dean must be active in one of the school's departments; a head/dean cannot be moved or deactivated until replaced | Leadership links stay valid without cascading surprises |
| Uploaded files are type-checked by content (magic bytes), not by the declared MIME type | Clients can lie about MIME types |
| E2E sign-in clears auth rate-limit counters before each login | The suite signs in more often from one IP than the per-IP limit allows |

## Phase 5 implementation decisions
| Decision | Reason |
|---|---|
| `search_vector` is a generated column declared `@default(dbgenerated())` in Prisma | Prisma cannot model generated columns; without the marker it tries to drop the expression on every diff |
| Non-managers see active courses and published sections (plus sections they teach) | FR-CRS-006; drafts and cancelled offerings are internal |
| Classroom conflicts block; overriding needs `section:override_conflicts` and a reason. Instructor conflicts block until the editor gives a reason | FR-CRS-007/008: rooms cannot be shared by accident; team teaching is legitimate but must be deliberate |
| The override reason is stored on the section and cleared when the schedule becomes conflict-free; publish/reopen re-check conflicts and require it | Roll-forward can copy clashing schedules as drafts; they must not go live unacknowledged |
| Schedule writes take `pg_advisory_xact_lock(hash(session))` | Two editors booking the same room at the same moment cannot both pass the check |
| One `POST /course-sections/{id}/transition` endpoint instead of separate publish/close/… routes | One permission-aware state machine, one audit format |
| Prerequisite minimum grades are stored as letters | Grading scales differ per session; the registration engine maps letters through the session's scale |
| A course coordinator must be a member (primary or joint) of the course's department | Same rule as heads of department |
| Roll-forward copies non-cancelled sections of active courses, skips existing codes and reports clashes | Re-running is safe; nothing is published automatically |

## Phase 6 implementation decisions
| Decision | Reason |
|---|---|
| Full pipeline runs before locking (fail fast); inside the student → section locks only volatile data (seats, the student's registrations, holds) is re-read | 50 concurrent requests for one seat queued long enough on the lock to hit transaction timeouts when the whole context was loaded inside it |
| Default transaction budget: 15 s to obtain a connection, 20 s to run | Lock queues on popular sections are expected; failures should be explicit, not premature |
| Promotion takes the section lock first and the candidate's student lock with `NOWAIT`; if busy, it re-queues itself | Avoids deadlocks with registrations that lock student → section |
| Ineligible waitlist candidates are cancelled (`PROMOTION_SKIPPED`) and notified rather than left in place | Leaving them would block the queue on every run; they can re-join once eligible |
| When the registration period has closed, promotion stops and the entries expire with the period | FR-REG-024 |
| Withdrawals and drops by students need `registration:self`; anyone else needs `registration:manage` covering the course's or the student's department | Department admins manage both their students and their courses |
| Seat-holding counters are maintained in the same transaction and reconciled hourly; the seed writes rows and lets the reconciler set counters | One code path defines what the counters mean |
| Pending registrations hold a seat (counted in `enrolledCount`) | FR-REG-016: approval must not be able to oversubscribe a section |
| Spring 2027 registration opens on 18 Nov 2026 in the seed, with cross-department approval | The seeded "today" needs an open window to exercise the engine |

## Phase 7 implementation decisions
| Decision | Reason |
|---|---|
| Faculty access = (permission at any scope, including OWN) **and** an instructor row on the section; administrators need an organisational grant covering the department | ADR-014: relationship permissions never cover organisational targets on their own |
| Sections a caller has no relationship with return 404, not 403 | API.md §5: do not reveal resources the caller may not know about |
| Teaching assistants see the roster and materials like other instructors | The SRS does not restrict TAs; load counting already excludes them |
| CSV export prefixes cells starting with `= + - @`, tab or CR with `'` and quotes every cell; UTF-8 BOM for spreadsheet apps | SECURITY.md §6 CSV-injection protection |
| Deleting a material deletes its stored object | Removed course content must not stay downloadable |
| Announcement notifications have no link yet | Students get announcement pages in Phase 8; a link to a page that does not exist would be broken |

## Phase 8 implementation decisions
| Decision | Reason |
|---|---|
| Catalog and registration screens default to the session whose registration window is open (then upcoming, then active); the timetable defaults to the running session | Students register for next term while attending this one |
| Each registration dialog generates one idempotency key | A double click or retried request returns the same registration (FR-REG-015) |
| Progress counts each passed course once, in the first group it fits (all-of, then lists, then categories, then free credits) | Prevents double counting across requirement groups |
| GPA uses every graded attempt; repeat policy (latest/best) is not configurable yet | FR-ACAD-008 lists the policy as configurable; it arrives with grading settings (Phase 10) |
| Testing Library's async wait is 4 s in web tests | Lazy route chunks occasionally exceeded the 1 s default under parallel load |

## Phase 9 implementation decisions
| Decision | Reason |
|---|---|
| Messages are plain text rendered with line breaks and http(s) links, never as HTML | Meets "sanitized markdown subset" safely; no HTML sanitiser to keep in sync |
| Students reach administrators through one support conversation per student, visible to administrators whose `message:moderate` grant covers the student's department | FR-COMM-002 "shared admin conversation" without exposing every admin's inbox |
| Direct and support messages notify a recipient only when the conversation goes from read to unread | One notification per burst instead of one per message |
| Announcement fan-out always runs on the queue, also for "publish now" | Large audiences (all students) never block the request; one code path for scheduled and immediate |
| Urgent announcements are emailed regardless of preferences | Urgent notices are the case email exists for |
| Feedback and tickets are routed to the submitter's department; university-wide grants see everything | Department administrators triage their own people (FR-COMM-011 scope model) |

## Phase 10 implementation decisions
| Decision | Reason |
|---|---|
| Approval posts immediately (no separate APPROVED state) | The SRS pairs approval with posting; one step avoids approved-but-unposted sheets |
| Unmarked components count as zero in the computed mark; excused ones are left out and weights rescaled | Matches common practice and keeps the suggested grade honest mid-session |
| Weights may never exceed 100 % and must total exactly 100 % to submit (when components exist) | FR-ACAD-004 without blocking instructors who grade without components |
| GPA repeat policy is university-wide | The SRS calls it configurable; per-session policies would make CGPA ambiguous |
| Posting completes registrations through the registration engine (`endRegistration`) | Keeps seat counters, events and the reconcile job consistent |

## Changelog
- 2026-11-21 — Phase 13 complete: production Compose fixes, compiled admin bootstrap, deployment/backup/monitoring guide with a tested restore, documentation pass. Project complete.
- 2026-11-21 — Phase 12 complete: permission matrix (588 cases), coverage gaps closed, concurrency tests, OWASP review with three fixes, k6 load script; 1,158 unit/integration + 54 E2E runs.
- 2026-11-21 — Phase 11 complete: administrator dashboard with scoped, cached analytics; 15-report center; CSV/XLSX exports with background jobs; 565 unit/integration + 54 E2E runs.
- 2026-11-21 — Phase 10 complete: attendance, assessments and gradebook, final grade workflow with posting, grade changes, transcripts with repeat policy, room availability; 551 unit/integration + 52 E2E runs.
- 2026-11-21 — Phase 9 complete: messaging with real-time delivery, discussions, announcements to every audience with scheduling and read tracking, notification preferences and email log, feedback and support tickets; 518 unit/integration + 48 E2E runs.
- 2026-11-20 — Phase 8 complete: student portal (catalog, course page with eligibility and registration, registrations, planner, timetable with iCal, progress, history, announcements, course pages); 457 unit/integration + 44 E2E runs.
- 2026-11-20 — Phase 7 complete: faculty portal (dashboard, assignments, workspace, roster and export, materials with uploads, section announcements); 441 unit/integration + 42 E2E runs.
- 2026-11-20 — Phase 6 complete: registration engine with eligibility, approvals, overrides, waitlists and offers, notifications, records and planner API, admin registration UI, seeded history and open registration; 414 unit/integration + 40 E2E runs. Fixed a database time-zone shift affecting every stored timestamp on non-UTC database servers.
- 2026-11-20 — Phase 5 complete: course catalog, prerequisites, mappings, restrictions, classrooms, sections with conflict detection, roll-forward (API, admin UI, seed), 361 unit/integration + 38 E2E runs.
- 2026-11-20 — Phase 4 complete: students, faculty, administrators, holds, bulk import, avatars and profiles (API, admin UI, portals, seed), 304 unit/integration + 34 E2E runs.
- 2026-11-20 — Phase 3 complete: university structure and academic calendar (API, admin UI, seed), 242 unit/integration + 28 E2E runs.
- 2026-11-20 — Phase 2 complete: authentication, sessions, RBAC with relationship scopes, audit log, admin/faculty/student portal shells, 155 unit/integration + 22 E2E tests.
- 2026-11-20 — Phase 1 complete: monorepo, API foundation, worker, storage, mail, sockets, OpenAPI, web shell, tests (52 + 6 E2E), Docker/CI files.
- 2026-11-20 — Phase 0 deliverables created: SRS, Architecture, Database (ERD), API, Security, Testing, Roles & Permissions, Roadmap, README.
