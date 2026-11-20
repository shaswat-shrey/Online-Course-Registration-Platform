# Software Requirements Specification
## University Course Registration & Academic Management System (UCRAMS)

| Field | Value |
|---|---|
| Document | SRS |
| Version | 0.1 (Phase 0 baseline) |
| Status | Draft for review |
| Last updated | 2026-11-20 |

> **Implementation status convention.** This SRS describes the *target* system. Nothing described here is implemented yet unless [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) marks it done. Requirements are tagged with a priority:
> **M** = Must (initial release), **S** = Should (initial release if time allows), **F** = Future (architecture must allow it; not in initial release).

---

## 1. Introduction

UCRAMS is a centralized web platform that lets a university manage its academic structure, course catalog, course sections, faculty assignments, student enrollment and registration, and in-platform communication, through three role-specific portals (Administrator, Faculty, Student) backed by one REST API.

## 2. Purpose

This document defines the functional and non-functional requirements, business rules, and acceptance criteria that the implementation, tests, and documentation are measured against. Every requirement has a stable ID, which tests and roadmap tasks refer to.

## 3. Scope

**In scope (initial release):** authentication and session management; RBAC with scoped permissions; university structure management (university, campuses, schools/faculties, departments, degrees, programs, specializations); academic calendar (years, sessions/terms, registration periods); course catalog with prerequisites and corequisites; course sections, meetings, classrooms and faculty assignments; a registration engine with eligibility rules, waitlists and concurrency safety; drop and withdrawal; course planner; degree progress; timetables; messaging; announcements; notifications; feedback; support tickets; course materials; dashboards; reports with CSV/XLSX export; audit logs; seed data.

**Foundational in the initial release (minimal working module, extended later):** attendance, assessments, grade entry and GPA under a configurable grading scale, academic records.

**Out of scope:** fee payment and billing, admissions/applications, hostel and library management, LMS-grade content authoring (quizzes taken online), payroll, alumni management, and native mobile apps. The API is designed so these can be added later.

## 4. Product Overview

### 4.1 Product perspective
A new, self-contained system. It is a modular monolith (one deployable API, a separate background worker process that uses the same codebase, and one SPA), with PostgreSQL as the system of record, Redis for cache, rate limits, queues and Socket.IO fan-out, and S3-compatible object storage for files. See [ARCHITECTURE.md](ARCHITECTURE.md).

### 4.2 Major functions
1. Identity, authentication, sessions, RBAC.
2. Academic structure management.
3. Academic calendar and registration-period management.
4. Course catalog and section scheduling.
5. Registration engine (register, waitlist, drop, withdraw, approvals).
6. Student self-service: catalog, planner, progress, timetable.
7. Faculty workspace: rosters, materials, announcements, attendance, assessments.
8. Communication: messaging, announcements, notifications, feedback, tickets.
9. Analytics, reports and exports.
10. Auditing and system settings.

### 4.3 Academic hierarchy

```
University
 ├── Campus (1..n)
 └── School  ("Faculty / School" in the UI, e.g. Faculty of Engineering)
      └── Department (e.g. Computer Science)
           ├── Program  = Degree type + Department + name  (e.g. "B.Tech in Computer Science")
           │    └── Specialization (0..n, e.g. "Molecular Biology" under "B.Sc. Biology")
           └── Course (owned by one department, may be mapped to many programs/specializations)
                └── CourseSection (one per course offering per academic session)
                     ├── SectionMeeting (day, time, classroom)
                     ├── SectionInstructor (faculty member, role)
                     └── CourseRegistration (student enrollment)
```

- **Degree** is the credential type (B.Tech, B.Sc., LL.B., MBA, Ph.D.) with a level (Undergraduate / Postgraduate / Doctoral). It is not owned by a department.
- **Program** is a concrete offering of a degree by a department, with its own duration, credit requirement and course requirements.
- **Specialization** narrows a program and may add its own required/elective courses and credit requirements.
- Courses may be shared across programs and taken cross-department.

## 5. Stakeholders

| Stakeholder | Interest |
|---|---|
| University leadership | Visibility into enrollment, capacity, workload |
| Registrar / academic office | Calendar, registration rules, records integrity |
| Department heads/administrators | Departmental courses, sections, staff, students |
| Faculty members | Teaching assignments, rosters, communication |
| Students | Discovering and registering for courses, tracking progress |
| IT operations | Deployment, security, backups, monitoring |
| Auditors / compliance | Audit trails, data privacy |

## 6. User Classes and Roles

| Role | Code | Scope | Summary |
|---|---|---|---|
| Super Administrator | `SUPER_ADMIN` | Global | Full system control including roles, permissions, settings |
| University Administrator | `UNIVERSITY_ADMIN` | Global | Manages structure, users, calendar, reports; cannot alter RBAC definitions |
| Academic Administrator | `ACADEMIC_ADMIN` | Global or School | Registrar-type: catalog, sections, registrations, records |
| Department Administrator | `DEPARTMENT_ADMIN` | Department | Same as academic admin, limited to one or more departments |
| Faculty Member | `FACULTY` | Own sections | Teaching, rosters, materials, course communication |
| Student | `STUDENT` | Self | Self-service registration and academic information |

A user may hold several role assignments, each with its own scope. The full matrix is in [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md).

## 7. User Characteristics

- Students: very large population, mostly mobile, low tolerance for confusing flows, peak load concentrated in registration windows.
- Faculty: moderate technical skill, desktop-first, need fast roster and communication tools.
- Administrators: power users working with large tables, filters, bulk actions and exports.

## 8. Operating Environment

- Browsers: current and previous major versions of Chrome, Edge, Firefox, Safari (desktop and mobile).
- Server: Linux containers (Docker), Node.js 22 LTS or newer, PostgreSQL 16 or newer, Redis 7 or newer, S3-compatible storage (MinIO for development).
- Development: macOS/Linux with Docker Compose. Where Docker is unavailable, native PostgreSQL and Redis installs are supported.

## 9. Technology Constraints

Mandated stack: React + TypeScript + Vite, React Router, TanStack Query, Zustand, Tailwind CSS, shadcn/ui, React Hook Form, Zod, Recharts, Socket.IO; Node.js + Express + TypeScript, Prisma, PostgreSQL, Redis, BullMQ, JWT with refresh-token rotation, Zod, Swagger/OpenAPI, Pino, Vitest, Supertest, Playwright.

## 10. Assumptions

- A-01: One university per deployment (single tenant). The `University` row exists so multi-tenant support can be added later (F).
- A-02: Accounts are provisioned by administrators (individually or by bulk import). Self-registration is disabled by default and can be enabled per role via settings.
- A-03: A credit-based system. Credits are decimals with one decimal place (e.g. 3.0, 1.5).
- A-04: Weekly recurring meeting patterns within an academic session are sufficient for timetabling. Exceptions (holidays, make-up classes) are F.
- A-05: All timestamps are stored in UTC. The university has one configured time zone, used for display and for interpreting deadlines.
- A-06: Grading scales are configured by administrators. No default grading policy is assumed beyond seed examples clearly marked as examples.
- A-07: Email delivery in development uses a local catcher (Mailpit). Production uses a configured SMTP provider.

## 11. Dependencies

PostgreSQL, Redis, S3-compatible object storage, SMTP provider, and the npm packages of the mandated stack.

## 12. System Architecture Overview

Modular monolith: `apps/api` (Express REST + Socket.IO), `apps/worker` entry point in the same package (BullMQ processors), `apps/web` (React SPA), and `packages/shared` (Zod schemas, permission constants, enums, DTO types shared by API and web). Details are in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 13. Functional Requirements (index)

Functional requirements are grouped by module in sections 15 to 24. ID prefixes:

| Prefix | Module |
|---|---|
| FR-AUTH | Authentication and sessions |
| FR-RBAC | Authorization |
| FR-ORG | University structure |
| FR-CAL | Academic calendar |
| FR-USER | User, student and faculty management |
| FR-CRS | Courses and sections |
| FR-REG | Registration engine |
| FR-ADMIN | Administrator portal |
| FR-FACULTY | Faculty portal |
| FR-STUDENT | Student portal |
| FR-ACAD | Attendance, assessments, grades, records |
| FR-COMM | Messaging, announcements, feedback, tickets |
| FR-NOTIF | Notifications |
| FR-RPT | Reports and analytics |
| FR-FILE | Documents and files |
| FR-AUDIT | Audit logging |
| FR-SRCH | Search |

## 14. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-PERF-001 | Performance | p95 latency ≤ 300 ms for read endpoints and ≤ 600 ms for registration submit under 200 concurrent registration requests on reference hardware (4 vCPU API, 4 vCPU DB). |
| NFR-PERF-002 | Performance | All list endpoints are paginated. Maximum page size is 100 (200 for exports via background job). |
| NFR-PERF-003 | Performance | The catalog search returns results in ≤ 500 ms p95 for 10,000 courses. |
| NFR-SCAL-001 | Scalability | The API is stateless; it scales horizontally behind a load balancer. Socket.IO uses the Redis adapter. |
| NFR-SCAL-002 | Scalability | Data model supports ≥ 50,000 students, ≥ 2,000 faculty, ≥ 10,000 courses and ≥ 5,000 sections per session. |
| NFR-REL-001 | Reliability | Registration operations are atomic. Partial state is never persisted. |
| NFR-REL-002 | Reliability | Background jobs retry with exponential backoff (default 5 attempts) and land in a failed set that admins can inspect. |
| NFR-REL-003 | Reliability | Database backups are automated daily, with point-in-time recovery documented. |
| NFR-AVAIL-001 | Availability | `/health/live` and `/health/ready` endpoints. Readiness checks DB and Redis. |
| NFR-AVAIL-002 | Availability | Redis outage degrades gracefully: cache misses fall through to DB. Rate limiting fails closed only on auth endpoints. |
| NFR-SEC-001 | Security | OWASP Top 10 (2021) is reviewed per release. See [SECURITY.md](SECURITY.md). |
| NFR-SEC-002 | Security | All authorization is enforced on the server. |
| NFR-USE-001 | Usability | Every page has loading, empty, error and success states. Destructive actions require confirmation. |
| NFR-USE-002 | Usability | The student portal is fully usable at 360 px width. |
| NFR-ACC-001 | Accessibility | WCAG 2.2 AA: keyboard navigation, focus visibility, labels, 4.5:1 contrast, no information conveyed by colour alone. |
| NFR-PRIV-001 | Privacy | Personal data is returned only to authorized viewers, and responses use role-specific DTOs (no over-fetching). |
| NFR-MAINT-001 | Maintainability | TypeScript strict mode, ESLint, Prettier. CI runs typecheck, lint and tests. |
| NFR-OBS-001 | Observability | Structured JSON logs (Pino) with request ID, user ID and session ID. Sensitive fields are redacted. |
| NFR-I18N-001 | Internationalization | UI strings are centralized to allow future translation (F: actual translations). |

---

## 15. Authentication Requirements

| ID | P | Requirement |
|---|---|---|
| FR-AUTH-001 | M | Users sign in with email (or institutional ID) and password. One login page serves all roles; the post-login redirect depends on the user's primary portal. |
| FR-AUTH-002 | M | Passwords are hashed with Argon2id (memory 19 MiB, iterations 2, parallelism 1 minimum; parameters configurable). |
| FR-AUTH-003 | M | Password policy: minimum 10 characters, checked against a common-password list, cannot equal email. Configurable. |
| FR-AUTH-004 | M | Short-lived JWT access tokens (default 15 min) carry `sub`, `sid` (session ID) and a permissions version, and are signed with a rotating key (`kid`). |
| FR-AUTH-005 | M | Opaque refresh tokens (256-bit random) are stored only as SHA-256 hashes, delivered in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`. Default lifetime is 7 days (30 with "remember me"). |
| FR-AUTH-006 | M | Refresh token rotation: each refresh issues a new token in the same family and marks the old one as used. |
| FR-AUTH-007 | M | Reuse detection: presenting an already-rotated refresh token revokes the whole session (family) and records a security event. A 10-second grace window tolerates concurrent tabs refreshing at once. |
| FR-AUTH-008 | M | Each login creates a `Session` with device/browser metadata (parsed user agent), IP address, created/last-seen timestamps. |
| FR-AUTH-009 | M | Users can list active sessions, revoke one session, and log out of all other sessions or all sessions. |
| FR-AUTH-010 | M | Logout revokes the current session and clears the cookie. |
| FR-AUTH-011 | M | Account lockout: after 5 consecutive failed attempts (configurable), the account is locked for 15 min, doubling up to 24 h. Admins can unlock. |
| FR-AUTH-012 | M | Login history records every attempt (success/failure reason, IP, user agent, timestamp), visible to the user (own) and authorized admins. |
| FR-AUTH-013 | M | Forgot password sends a single-use token (stored hashed, 30 min expiry). The response is identical whether or not the account exists. |
| FR-AUTH-014 | M | Password reset revokes all sessions. |
| FR-AUTH-015 | M | Change password requires the current password and revokes all other sessions. |
| FR-AUTH-016 | M | Email verification: provisioned accounts receive an activation link to set the first password. Verification tokens are hashed, single-use and expire after 72 h. |
| FR-AUTH-017 | M | Rate limiting (Redis-backed) on login, refresh, forgot-password, reset and verification endpoints, both per IP and per account identifier. |
| FR-AUTH-018 | M | Deactivated or suspended accounts cannot log in, and their sessions are revoked at the time of suspension. |
| FR-AUTH-019 | S | Optional TOTP MFA. The data model has `mfaEnabled`, an encrypted secret and recovery-code hashes. The login flow supports an `MFA_REQUIRED` intermediate step. Enforcement for admin roles is configurable. |
| FR-AUTH-020 | M | Changing a user's roles or permissions increments `permissionsVersion`, so the next request with a stale access token forces a refresh and the claims are recalculated. |

## 16. Authorization Requirements

| ID | P | Requirement |
|---|---|---|
| FR-RBAC-001 | M | Permissions are granular strings (`resource:action`, e.g. `course:create`). Roles are named bundles of permissions. |
| FR-RBAC-002 | M | A user has one or more role assignments, each with a scope: `GLOBAL`, `SCHOOL(id)`, or `DEPARTMENT(id)`. |
| FR-RBAC-003 | M | Every API endpoint declares the permission it requires. Resource-level checks verify that the target entity falls within the caller's scope (a department admin cannot edit another department's course). |
| FR-RBAC-004 | M | Ownership rules: students access only their own records; faculty access rosters only of sections they are assigned to. |
| FR-RBAC-005 | M | Super Administrators can create custom roles and edit role-permission mappings via the UI. System roles cannot be deleted. |
| FR-RBAC-006 | M | The frontend hides navigation and actions the user lacks permission for, using the permission list from `/auth/me`. This is a convenience only; the server enforces. |
| FR-RBAC-007 | M | Authorization failures return 403 without revealing whether the resource exists when the caller has no read access (404 is returned instead). |

## 17. Administrator Requirements

### 17.1 Dashboard
| ID | P | Requirement |
|---|---|---|
| FR-ADMIN-001 | M | The dashboard shows counts from live DB data: students (total/active), faculty, admins, schools, departments, programs, specializations, courses, sections, registrations, active sessions, pending registrations, available seats, capacity utilization. |
| FR-ADMIN-002 | M | Charts: enrollment trend by session, students per department/program/school, faculty distribution, top courses by registrations, registration status distribution, capacity utilization by department. |
| FR-ADMIN-003 | M | Filters: academic year, session, school, department, degree, program, specialization, course. Filters are applied server-side. |
| FR-ADMIN-004 | M | Widgets: recently added users, pending requests (registration approvals, open tickets, open feedback), recent audit activity, system alerts (failed jobs, sections below minimum enrollment, sections without instructors). |
| FR-ADMIN-005 | S | Dashboard aggregates are cached in Redis for 60 s per filter combination and invalidated on registration writes. |
| FR-ADMIN-006 | M | Scoped admins see dashboard data restricted to their scope. |

### 17.2 University and structure management
| ID | P | Requirement |
|---|---|---|
| FR-ORG-001 | M | Edit university profile (name, short name, logo, contact, time zone, academic configuration). |
| FR-ORG-002 | M | CRUD campuses (name, code, address, status). |
| FR-ORG-003 | M | CRUD schools (name, code, description, dean, campus, status). |
| FR-ORG-004 | M | CRUD departments: name, code, description, parent school, head of department, department administrators, contact email/phone/office, status, timestamps. |
| FR-ORG-005 | M | The department detail page shows programs, courses, faculty and students (paginated) and statistics. |
| FR-ORG-006 | M | CRUD degrees (code, name, level). |
| FR-ORG-007 | M | CRUD programs: degree, owning department, name, code, duration (years), number of sessions, total required credits, minimum core/elective credits, status. |
| FR-ORG-008 | M | Define program requirements as requirement groups (e.g. "Core", "Department electives: choose 12 credits from list", "Open electives: 6 credits from any course"). |
| FR-ORG-009 | M | CRUD specializations under a program, with their own requirement groups and additional credits. |
| FR-ORG-010 | M | Entities are deactivated, not deleted, once referenced by academic data. Hard delete is allowed only for unreferenced entities. |
| FR-ORG-011 | M | Unique codes: school, department, program, course and section codes are unique within their parent scope (see DATABASE.md). |

### 17.3 Academic calendar
| ID | P | Requirement |
|---|---|---|
| FR-CAL-001 | M | CRUD academic years (label e.g. "2026–2027", start/end dates). |
| FR-CAL-002 | M | CRUD academic sessions (terms) inside a year: type (Fall, Spring, Summer, Winter, Trimester 1–3, Custom), start/end dates, status `PLANNED → ACTIVE → COMPLETED` (or `ARCHIVED`). At most one session is the "current" session per session type. |
| FR-CAL-003 | M | Registration periods per session: registration open/close, add/drop deadline, withdrawal deadline, late-registration window with an approval requirement. |
| FR-CAL-004 | M | Priority windows: an earlier open time for cohorts defined by program, year of study, or student group. |
| FR-CAL-005 | M | Session-level policy: min/max credits per student, max credits with override, approval required (none / all / cross-department only), waitlist enabled, waitlist max size per section, waitlist claim window, drop requires approval after X, withdrawal requires approval. |
| FR-CAL-006 | S | Academic calendar events (holidays, exam weeks) shown on the timetables. |

### 17.4 User, faculty and student management
| ID | P | Requirement |
|---|---|---|
| FR-USER-001 | M | Create, edit, deactivate and reactivate users. Assign/revoke roles with scope. |
| FR-USER-002 | M | Faculty profiles: employee ID, department (primary plus optional secondary), designation (Professor, Associate Professor, Assistant Professor, Lecturer, Adjunct, Visiting), qualifications, specialization, research interests, office location, office hours, max teaching load (credits or hours per session). |
| FR-USER-003 | M | The faculty detail view shows teaching schedule, sections, student counts, and workload vs maximum load. |
| FR-USER-004 | M | Student records: auto-generated student ID (configurable pattern, e.g. `{YY}{DEPT}{SEQ}`), program, specialization, admission session, expected graduation, year of study, student group/cohort, status (`ACTIVE`, `ON_LEAVE`, `SUSPENDED`, `GRADUATED`, `WITHDRAWN`, `DISMISSED`). |
| FR-USER-005 | M | Bulk import of students and faculty from CSV/XLSX. Validation preview before commit, processed by a background job, with per-row result report. Imports are idempotent on external ID/email. |
| FR-USER-006 | M | Program/specialization changes are recorded in a program history table. Completed academic records are preserved. |
| FR-USER-007 | M | Registration holds (financial, academic, disciplinary, administrative) with reason, creator and release. Active holds block registration. |
| FR-USER-008 | M | Suspending a student revokes sessions and blocks registration. Existing registrations are unchanged unless the admin chooses to drop them. |
| FR-USER-009 | M | Deactivating a faculty member is blocked while they hold primary assignments in current/future sections, unless the admin reassigns or confirms leaving the sections unassigned (sections then show "Instructor TBA" and an alert). |
| FR-USER-010 | M | Admin management: create admin accounts and assign scoped admin roles (by permission). |

### 17.5 Registration oversight
| ID | P | Requirement |
|---|---|---|
| FR-ADMIN-020 | M | List all registrations with filters (session, status, department, course, section, student, date range). |
| FR-ADMIN-021 | M | Approve/reject pending registrations individually or in bulk, with reason. |
| FR-ADMIN-022 | M | Administrative register/drop/withdraw on a student's behalf with override flags (capacity, prerequisite, time conflict, credit limit, period). Every override requires a reason and is audited. |
| FR-ADMIN-023 | M | View and manage waitlists (reorder only with override permission, remove, promote manually). |
| FR-ADMIN-024 | M | The conflicts view lists students with timetable conflicts (created via override) and sections over capacity (created via override). |

## 18. Faculty Requirements

| ID | P | Requirement |
|---|---|---|
| FR-FACULTY-001 | M | Dashboard: assigned sections in the current session, total students, today's/upcoming classes, weekly schedule, workload vs max, registration fill per section, upcoming assessments, recent announcements, unread messages, pending tasks (grades due, open tickets). |
| FR-FACULTY-002 | M | Profile: view all fields; edit permitted fields (photo, phone, office, office hours, research interests, qualifications). |
| FR-FACULTY-003 | M | Teaching assignments list (current, upcoming, past sessions) with course details, syllabus, outcomes, schedule, classroom, capacity and enrollment. |
| FR-FACULTY-004 | M | Course workspace per section: overview, roster, materials, announcements, discussion, schedule, attendance, assessments, statistics. |
| FR-FACULTY-005 | M | Roster: student ID, name, email, program, year, registration status and date, section, attendance %, assessment summary. Search, filter, paginate, and export CSV (permission `roster:export`). |
| FR-FACULTY-006 | M | Faculty view student profiles limited to academic-relevant fields (no address, emergency contact) for students in their sections only. |
| FR-FACULTY-007 | M | Upload, organize (folders/weeks), publish/unpublish and delete course materials. Only registered students and instructors can access published materials. |
| FR-FACULTY-008 | M | Publish announcements to their sections (one or all of their sections). |
| FR-FACULTY-009 | M | Message individual students in their sections, a whole section (section conversation), and administration. |
| FR-FACULTY-010 | M | Submit feedback and support tickets (course change requests, resource requests, academic issues) to administration. |
| FR-FACULTY-011 | M | Faculty cannot send university-wide announcements unless granted `announcement:publish_global`. |

## 19. Student Requirements

| ID | P | Requirement |
|---|---|---|
| FR-STUDENT-001 | M | Dashboard: welcome, profile summary (ID, program, department, specialization, year, current session), registered courses and credits, credit progress, upcoming classes, mini timetable, registration deadlines and status, pending items (waitlists, pending approvals), announcements, notifications, recent activity. |
| FR-STUDENT-002 | M | Profile: view all fields; edit only phone, personal email, address, emergency contact, photo (configurable list). |
| FR-STUDENT-003 | M | Catalog search and filters: name, code, department, degree, program, specialization, session, category, instructor, credits range, level, availability (open seats / waitlist open). |
| FR-STUDENT-004 | M | Course detail: description, credits, category, level, prerequisites/corequisites with the student's personal satisfaction status, outcomes, syllabus (file or rich text), and sections with instructor, schedule, room, seats and waitlist counts. |
| FR-STUDENT-005 | M | Eligibility preview: before submitting, the student sees every rule's result for a chosen section (pass/fail with reason). |
| FR-STUDENT-006 | M | Registered courses view: per session, status, credits, section, instructors, schedule; drop/withdraw actions when allowed with a deadline indicator. |
| FR-STUDENT-007 | M | Waitlist view: position, joined time, leave waitlist. |
| FR-STUDENT-008 | M | Course planner: add courses/sections to a plan for a session, see total credits, conflicts and prerequisite issues, compare sections, and register for the whole plan in one action (each item processed independently with individual results). |
| FR-STUDENT-009 | M | Academic progress: total required, completed, in progress, remaining credits; requirement groups with completed/in-progress/pending courses; specialization progress. Computed from academic records and program requirements. |
| FR-STUDENT-010 | M | Weekly timetable (calendar grid on desktop, day list on mobile) with course, section, instructor, room, day, start/end time. Export to iCal (S). |
| FR-STUDENT-011 | M | Academic history: per session, courses, credits, grades (when released), session GPA and cumulative GPA (when a grading scale is configured). |
| FR-STUDENT-012 | M | Communication: message instructors of their current sections, message administration (support inbox), participate in section discussion, submit feedback and tickets, and track replies and status. |

## 20. Course Registration Requirements

### 20.1 Course and section management
| ID | P | Requirement |
|---|---|---|
| FR-CRS-001 | M | CRUD courses: code (unique), title, description, department, credits, level (100–900 or UG/PG), recommended session/year, category (Core, Elective, General Education, Laboratory, Seminar, Research, Project, Internship, Practical), learning outcomes (ordered list), syllabus (rich text plus optional file), assessment structure (component/weight list, informational), default max/min enrollment, coordinator, status (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`). |
| FR-CRS-002 | M | Map a course to programs and specializations with a type per mapping (core/elective). |
| FR-CRS-003 | M | Prerequisites as an AND of OR-groups (e.g. (CS101 or CS102) and MA101) with an optional minimum grade per item. Corequisites as a list (must be completed or registered in the same session). Cycles are rejected. |
| FR-CRS-004 | M | Restrictions per course or section: allowed departments/programs/specializations/years of study, with "include" or "exclude" mode. |
| FR-CRS-005 | M | CRUD sections: course, session, section code (unique per course + session), capacity, waitlist capacity, campus, meetings (day, start, end, classroom, type), instructors (primary/secondary), registration status (open/closed independently of section status), section status `DRAFT → PUBLISHED → CLOSED / CANCELLED → COMPLETED`. |
| FR-CRS-006 | M | Only `PUBLISHED` sections are visible to students. Registration requires section status `PUBLISHED` and registration status open. |
| FR-CRS-007 | M | Classroom conflict detection: a classroom cannot have overlapping meetings in the same session (blocked unless overridden). |
| FR-CRS-008 | M | Instructor conflict detection: an instructor cannot have overlapping meetings (warning, override with reason). Workload exceeding max load produces a warning. |
| FR-CRS-009 | M | Lowering capacity below current enrollment is rejected. Raising capacity triggers waitlist promotion. |
| FR-CRS-010 | M | Cancelling a section moves all active registrations to `CANCELLED` and waitlist entries to `CANCELLED`, notifies students and instructors, and is audited. |
| FR-CRS-011 | M | Copy sections from a previous session (bulk "roll forward") as `DRAFT`. |
| FR-CRS-012 | M | CRUD classrooms: building, room number/name, campus, capacity, type, equipment (tag list), status. |

### 20.2 Registration engine
| ID | P | Requirement |
|---|---|---|
| FR-REG-001 | M | A student submits a registration for a section. The engine evaluates all rules in this order and returns every failure (not just the first) in the eligibility preview, and the first blocking failure code on submit. |
| FR-REG-002 | M | Rule: account active and student status `ACTIVE` → `STUDENT_NOT_ACTIVE`. |
| FR-REG-003 | M | Rule: no active registration hold → `REGISTRATION_HOLD`. |
| FR-REG-004 | M | Rule: registration window open for this student, accounting for priority windows and late registration → `REGISTRATION_PERIOD_CLOSED` / `REGISTRATION_NOT_YET_OPEN`. |
| FR-REG-005 | M | Rule: section `PUBLISHED`, registration open, course `ACTIVE` → `SECTION_NOT_AVAILABLE`. |
| FR-REG-006 | M | Rule: not already registered/pending/waitlisted in any section of the same course in this session → `DUPLICATE_REGISTRATION`. |
| FR-REG-007 | M | Rule: course not already passed (unless the course is marked repeatable) → `COURSE_ALREADY_COMPLETED`. |
| FR-REG-008 | M | Rule: prerequisites satisfied by academic records (passing grade at or above the required minimum; in-progress courses count only if the policy allows) → `PREREQUISITE_NOT_MET`. |
| FR-REG-009 | M | Rule: corequisites completed or registered/pending in the same session (or included in the same batch submission) → `COREQUISITE_NOT_MET`. |
| FR-REG-010 | M | Rule: department/program/specialization/year restrictions → `RESTRICTION_NOT_MET`. |
| FR-REG-011 | M | Rule: resulting credits ≤ maximum credit limit (registered + pending, waitlisted excluded by default, configurable) → `CREDIT_LIMIT_EXCEEDED`. |
| FR-REG-012 | M | Rule: no time overlap with the student's registered/pending sections' meetings in the same session → `TIMETABLE_CONFLICT`. |
| FR-REG-013 | M | Rule: seat available → otherwise `SECTION_FULL`, and if the waitlist is enabled and not full, the response offers waitlisting (`WAITLIST_AVAILABLE`). |
| FR-REG-014 | M | Concurrency: seat allocation happens in one DB transaction that locks the section row (`SELECT … FOR UPDATE`), re-checks capacity, inserts the registration and increments `enrolledCount`. A DB check constraint `enrolled_count <= capacity` and a partial unique index on active (student, course, session) registrations are the last line of defence. The capacity check constraint can only be exceeded by explicit admin override, which raises capacity rather than bypassing it. |
| FR-REG-015 | M | Idempotency: registration submit accepts an `Idempotency-Key` header. Repeated submissions with the same key return the original result. |
| FR-REG-016 | M | Approval: if the session policy requires approval for this registration, it is created as `PENDING` and holds a seat. Approval → `REGISTERED`. Rejection → `REJECTED`, releasing the seat. |
| FR-REG-017 | M | Drop: before the add/drop deadline, the student can drop → `DROPPED` (no transcript entry); the seat is released and waitlist promotion is triggered. |
| FR-REG-018 | M | Withdraw: after add/drop and before the withdrawal deadline → `WITHDRAWN` (transcript shows W; no credits; does not count toward GPA). Optional approval per policy (status `WITHDRAWAL_PENDING` modelled as a pending request on the registration). |
| FR-REG-019 | M | Dropping a course that is a corequisite of another registered course is blocked unless both are dropped together (or admin override). |
| FR-REG-020 | M | Every status transition is written to `RegistrationEvent` (from, to, actor, reason, timestamp) to form the registration history. |
| FR-REG-021 | M | Waitlist: join if the section is full, the waitlist is enabled and not full, and all other rules pass (capacity aside). Positions are ordered by `joinedAt`, then ID. |
| FR-REG-022 | M | Waitlist promotion when a seat frees up (drop, reject, capacity increase, cancellation of another registration): a job processes the section's waitlist in order inside a section-locked transaction. Each candidate's eligibility is re-validated (period, credits, conflicts, holds). Ineligible candidates are skipped and notified. The first eligible candidate is registered (or offered the seat, per policy). |
| FR-REG-023 | M | Promotion modes (session policy): `AUTO_ENROLL` (default) or `OFFER` with a claim window (e.g. 24 h); an unclaimed offer expires and moves to the next candidate. |
| FR-REG-024 | M | Waitlist cancellation by the student. All waitlist entries become `EXPIRED` when the registration period closes. |
| FR-REG-025 | M | Batch registration from the planner processes items in a deterministic order (corequisite pairs together); each item succeeds or fails independently and the response lists individual results. |
| FR-REG-026 | M | Admin overrides (FR-ADMIN-022) bypass specific rules only; all other rules still run. |
| FR-REG-027 | M | Registration lifecycle at session completion: `REGISTERED` → `COMPLETED` when the final grade is posted (or `INCOMPLETE` if the grading scale has an incomplete grade). |
| FR-REG-028 | M | Notifications on registration success, pending, approval, rejection, waitlist join, promotion, offer, offer expiry, drop, withdrawal and cancellation. |

### 20.3 Registration status lifecycle

```
                   ┌──────────────── reject ─────────────┐
                   │                                      ▼
 submit ──► PENDING ──approve──► REGISTERED ──drop──► DROPPED
   │                                │  │
   │ (no approval needed)           │  └─withdraw──► WITHDRAWN
   └───────────────────────────────►│
                                    ├─section cancelled──► CANCELLED
                                    └─grade posted──► COMPLETED
 submit (full) ──► WAITLISTED ──promote──► REGISTERED or PENDING
                        ├─leave──► CANCELLED
                        ├─period closed──► EXPIRED
                        └─(OFFER mode) OFFERED ──claim──► REGISTERED
                                         └─timeout──► EXPIRED
 PENDING ──student cancels──► CANCELLED
```

Statuses: `PENDING`, `REGISTERED`, `WAITLISTED`, `OFFERED`, `DROPPED`, `WITHDRAWN`, `REJECTED`, `CANCELLED`, `EXPIRED`, `COMPLETED`.

"Approved" from the original brief is represented by the `PENDING → REGISTERED` transition with an `APPROVED` event, not by a separate resting status (see ADR-007 in ARCHITECTURE.md).

Seat-holding statuses: `PENDING`, `REGISTERED`, `OFFERED`. `enrolledCount` equals the count of these.

## 21. Academic Management Requirements

| ID | P | Requirement |
|---|---|---|
| FR-ACAD-001 | M | Timetables: section, student, faculty and classroom timetables are generated from section meetings. |
| FR-ACAD-002 | M | Classroom availability view per session (free/busy grid). |
| FR-ACAD-003 | S | Attendance: instructors create class sessions (dates) per section and record status (Present, Absent, Late, Excused). Students see their own attendance; the roster shows %. Enabled per section. |
| FR-ACAD-004 | S | Assessments: instructors define components (assignment, quiz, exam, project, lab, other) with weights totalling 100 % and max score, enter scores, and publish to students. |
| FR-ACAD-005 | M | Grading scales: configurable scales (letter, min percentage, grade points, pass/fail, counts in GPA). Each session references a scale. No default policy is hardcoded. |
| FR-ACAD-006 | S | Final grade submission per section by the primary instructor → admin approval (configurable) → posted to academic records. Grade changes after posting require a reason and are versioned (grade history). |
| FR-ACAD-007 | M | Academic records: one record per completed course attempt (from enrollment, transfer or exemption) with grade, points and credits earned. These records are the source for prerequisites and progress. |
| FR-ACAD-008 | M | GPA is computed only when the session's scale defines grade points: Σ(points × credits) / Σ(credits) over GPA-counting records. The repeat policy (latest/best/all) is configurable. |
| FR-ACAD-009 | M | Academic records are never hard-deleted. Corrections create new versions. |

## 22. Communication Requirements

| ID | P | Requirement |
|---|---|---|
| FR-COMM-001 | M | Direct (1:1) conversations, persisted in PostgreSQL, delivered in real time via Socket.IO. |
| FR-COMM-002 | M | Who may start a direct conversation with whom: Student→Faculty only if the student is registered in one of the faculty member's current sections (or the setting allows any faculty); Student→Admin only via the support inbox (a shared admin conversation); Faculty→Student only for students in their sections; Faculty↔Admin, Admin→anyone allowed. |
| FR-COMM-003 | M | Section conversations: auto-created per section, membership synced with the roster (instructors plus seat-holding students). Instructors can set the conversation to announcement-only mode. |
| FR-COMM-004 | M | Messages: text (sanitized markdown subset), attachments (via the file service), edit within 15 min, soft-delete by author, timestamps. |
| FR-COMM-005 | M | Read receipts by per-participant last-read pointer. Unread counts per conversation and total. |
| FR-COMM-006 | M | Search within the user's own conversations (PostgreSQL full-text). |
| FR-COMM-007 | M | Course discussions: threaded posts (question/discussion type) with replies, per section, membership-enforced; instructors can pin, lock and mark an answer. |
| FR-COMM-008 | M | Announcements: title, rich content (sanitized), attachments, audiences (all students, all faculty, all admins, specific users, schools, departments, programs, specializations, courses, sections, years of study), schedule publish time, expiry, priority (normal/important/urgent), pin, author, read tracking. |
| FR-COMM-009 | M | Audience resolution at read time (announcement visible if the user matches any audience), and at publish time for notification fan-out (background job). |
| FR-COMM-010 | M | Scheduled announcements are published by a delayed BullMQ job. Editing the schedule reschedules the job. |
| FR-COMM-011 | M | Who may target what: faculty → own sections/courses only; department admin → own department scope; global admins → any. Enforced server-side. |
| FR-COMM-012 | M | Feedback: category, subject, description, related department/course, priority, status (`OPEN`, `UNDER_REVIEW`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`), assigned admin, responses, resolution note, timestamps. Optionally anonymous to non-super admins (S). |
| FR-COMM-013 | M | Support tickets: human-readable ticket number (e.g. `TCK-2026-000123`), owner, category (Course registration, Academic, Faculty, Technical, Account, Department, Other), priority, description, attachments, assignee, threaded responses (public and internal notes), status (`OPEN`, `IN_PROGRESS`, `WAITING_ON_USER`, `RESOLVED`, `CLOSED`), and a status-change history. |
| FR-COMM-014 | M | The ticket owner can reply and reopen within 7 days of resolution. Admins can assign, change priority, add internal notes (invisible to the owner) and resolve. |

## 23. Notification Requirements

| ID | P | Requirement |
|---|---|---|
| FR-NOTIF-001 | M | In-app notifications with category (registration, waitlist, announcement, message, ticket, feedback, schedule, system), title, body, link, read/unread, created timestamp. |
| FR-NOTIF-002 | M | Real-time push via Socket.IO to the user room. Unread badge count. |
| FR-NOTIF-003 | M | Mark one, several or all as read. Paginated history; notifications older than 180 days are purged by a job (configurable). |
| FR-NOTIF-004 | M | Preferences per category and channel (in-app, email). Some categories are mandatory (e.g. registration cancellation). |
| FR-NOTIF-005 | M | Email delivery through a BullMQ email queue with templates, retries and a failure log. |
| FR-NOTIF-006 | S | Digest mode for email (daily summary) per user preference. |

## 24. Reporting Requirements

| ID | P | Requirement |
|---|---|---|
| FR-RPT-001 | M | A report center with these reports: students, faculty, departments, programs, specializations, course enrollment, section enrollment, registrations, capacity, faculty workload, academic performance (grade distribution), course completion, student credits, enrollment trends, incomplete registrations (students below minimum credits / with pending items). |
| FR-RPT-002 | M | Every report supports server-side filtering, sorting and pagination, and respects the caller's scope. |
| FR-RPT-003 | M | Export to CSV and XLSX. Exports of more than 5,000 rows run as a background job that produces a file with a signed download link and a notification on completion. |
| FR-RPT-004 | M | Report exports are audited. |

### Audit
| ID | P | Requirement |
|---|---|---|
| FR-AUDIT-001 | M | Audit log for: auth security events, user/role changes, structure CRUD, course/section CRUD, registration overrides and admin actions, grade changes, announcement publishing, settings changes, exports. |
| FR-AUDIT-002 | M | Each entry: actor user ID, actor role context, action, entity type and ID, before/after (changed fields only, sensitive fields redacted), IP, user agent, request ID, timestamp. |
| FR-AUDIT-003 | M | The audit log is append-only (no update/delete API; DB role has insert/select only in production). |
| FR-AUDIT-004 | M | Audit viewer with filters and export (permission `audit:read`). |

### Files
| ID | P | Requirement |
|---|---|---|
| FR-FILE-001 | M | Uploads go to object storage. Flow: request upload → server validates intent and permission → presigned PUT (or server-proxied upload in development) → complete → server verifies size, sniffs magic bytes, computes checksum → status `READY`. |
| FR-FILE-002 | M | Allow-listed types per context (images for avatars; PDF/Office/images/zip for materials; etc.), size limits per context (e.g. 5 MB avatar, 50 MB material). |
| FR-FILE-003 | M | Downloads use short-lived signed URLs, issued only after a permission check against the owning context (material → section membership, etc.). |
| FR-FILE-004 | M | Stored object keys are random UUIDs. Original filenames are sanitized metadata only. |
| FR-FILE-005 | S | Antivirus scanning hook (ClamAV) as a background job; files stay `PENDING_SCAN` until clean when enabled. |

### Search
| ID | P | Requirement |
|---|---|---|
| FR-SRCH-001 | M | Global search across courses, departments, programs, specializations, faculty, and students (authorized roles only), using PostgreSQL full-text (`tsvector`) plus trigram similarity for codes and names. |
| FR-SRCH-002 | M | Results are permission-filtered server-side and grouped by type. The frontend debounces input (300 ms) and cancels stale requests. |

---

## 25. Database Requirements

- DB-001: PostgreSQL is the source of truth. All schema changes go through Prisma migrations.
- DB-002: Foreign keys on every relation. `ON DELETE RESTRICT` by default; `CASCADE` only for pure child rows with no historical value (e.g. role-permission links, plan items).
- DB-003: Soft status (`status`, `deactivatedAt`) instead of deletes for academic entities.
- DB-004: Check constraints for invariants (capacity, credit ranges, time ranges, weights).
- DB-005: Indexes for every foreign key used in filters, plus composite indexes for hot queries (see DATABASE.md).
- DB-006: Seeds are idempotent (upsert on natural keys).

## 26. API Requirements

- API-001: REST under `/api/v1`, JSON, consistent response envelope (see API.md).
- API-002: Zod validation for params, query and body. Unknown fields are stripped.
- API-003: Pagination (`page`, `limit`), sorting (`sort=field:asc,field2:desc` with an allow-list), filtering by documented query params, `q` for search.
- API-004: OpenAPI 3.1 spec generated from the Zod schemas, served at `/api/docs` (disabled or auth-protected in production).
- API-005: Error codes are stable machine-readable strings.

## 27. Security Requirements

See [SECURITY.md](SECURITY.md). Key IDs: NFR-SEC-001..020, covering headers (Helmet), CORS allow-list, CSRF strategy, input validation, output encoding, rate limiting, lockout, enumeration protection, secret management, env validation, file safety, audit, and least-privilege DB roles.

## 28–33. Performance, Scalability, Reliability, Availability, Usability, Accessibility

Covered by NFR-PERF-*, NFR-SCAL-*, NFR-REL-*, NFR-AVAIL-*, NFR-USE-*, NFR-ACC-* in section 14.

## 34. Data Privacy Requirements

| ID | Requirement |
|---|---|
| NFR-PRIV-001 | Role-specific DTOs; sensitive fields (address, emergency contact, DOB, holds reasons) are visible only to the student and to admins with `student:read_sensitive`. |
| NFR-PRIV-002 | No personal data in URLs, logs or cache keys. Logs redact `password`, `token`, `authorization`, `cookie`, emails in error contexts. |
| NFR-PRIV-003 | Student records are not cached in shared Redis keys. Only aggregate statistics and public catalog data are cached. |
| NFR-PRIV-004 | Data export of a single user's personal data on request (S). |
| NFR-PRIV-005 | Retention: login history 1 year, notifications 180 days, audit logs 7 years (configurable). |

## 35. Business Rules

| ID | Rule |
|---|---|
| BR-001 | A student belongs to exactly one active program at a time and at most one specialization in that program. |
| BR-002 | A student may register for at most one section per course per session. |
| BR-003 | A section's seat-holding registrations never exceed its capacity. |
| BR-004 | Capacity cannot be lowered below current seat-holding count. |
| BR-005 | Registration, drop and withdrawal are governed by the session's registration period and policy. Admin overrides are audited. |
| BR-006 | Dropped registrations leave no transcript entry. Withdrawn ones appear as W with zero credits. |
| BR-007 | A course cannot be its own prerequisite, directly or transitively. |
| BR-008 | Corequisites must be completed or concurrently registered. Dropping one side of an active corequisite pair is blocked. |
| BR-009 | A cancelled section cancels its registrations; students are notified and no transcript entry is created. |
| BR-010 | Faculty reassignment on a section transfers roster access and section-conversation membership immediately; past messages remain. |
| BR-011 | Program/specialization change keeps completed records. Progress is recalculated against the new requirements; registrations in the current session remain. |
| BR-012 | Department transfer = program change into a program of another department (same rules as BR-011). |
| BR-013 | Suspended students cannot register, drop or withdraw (admins can act on their behalf). |
| BR-014 | Sections with no primary instructor may be published only with `section:publish_without_instructor`. They display "Instructor TBA". |
| BR-015 | Sections below minimum enrollment at the add/drop deadline are flagged on the dashboard for admin decision (cancel or keep). No automatic cancellation. |
| BR-016 | Academic records and registration events are never deleted. |
| BR-017 | Credits counted toward the limit = Σ credits of PENDING + REGISTERED + OFFERED registrations in the session (+ WAITLISTED if the policy says so). |
| BR-018 | Time conflict = same day and `startA < endB && startB < endA`, within overlapping session date ranges. Back-to-back classes are allowed. |
| BR-019 | Late registration (after the open window, inside the late window) creates PENDING registrations requiring approval. |
| BR-020 | Changing the academic session dates or registration period dates of an `ACTIVE` session is audited and notifies affected students if deadlines move earlier. |

## 36. Use Cases (primary)

| ID | Actor | Use case | Main flow (abridged) |
|---|---|---|---|
| UC-01 | Any | Sign in | Enter credentials → validated → session created → redirect to portal. Alternatives: locked, unverified, MFA required. |
| UC-02 | Admin | Create department | Open Departments → New → fill form → saved → audit entry → appears in list. |
| UC-03 | Admin | Create program with requirements | Create program → add requirement groups → map courses. |
| UC-04 | Admin | Create course and section | Create course (prereqs) → create section (meetings, room, instructor) → conflict checks → publish. |
| UC-05 | Admin | Configure registration period | Select session → set windows, priority cohorts, policy → save. |
| UC-06 | Admin | Bulk import students | Upload CSV → preview validation → confirm → job processes → result report → activation emails queued. |
| UC-07 | Student | Register for a section | Catalog → course → section → eligibility preview → submit → REGISTERED/PENDING/WAITLIST offer → confirmation + notification. |
| UC-08 | Student | Drop / withdraw | Registered courses → drop/withdraw → confirm → status updated → seat released → waitlist promotion. |
| UC-09 | Student | Plan and batch-register | Planner → add items → check conflicts/credits → register all → per-item results. |
| UC-10 | System | Promote waitlist | Seat freed → job → lock section → validate candidates → enroll/offer → notify. |
| UC-11 | Faculty | View roster and export | Sections → section → roster → filter → export CSV. |
| UC-12 | Faculty | Publish section announcement | Workspace → announcements → compose → audience = section(s) → publish → students notified. |
| UC-13 | Student | Submit ticket | Support → new ticket → category, description, attachment → submit → admin assigned → reply → resolve. |
| UC-14 | Admin | Approve pending registrations | Registrations → filter PENDING → bulk approve/reject with reason. |
| UC-15 | Admin | Cancel section | Section → cancel → confirm impact (n students) → registrations cancelled → notifications. |
| UC-16 | Admin | Generate report and export | Reports → choose report → filters → view → export CSV/XLSX (background if large). |
| UC-17 | Any | Manage sessions | Profile → security → list sessions → revoke one/all. |

## 37. Acceptance Criteria (selected; each maps to tests in TESTING.md)

| ID | Criterion |
|---|---|
| AC-REG-001 | With capacity 1 and 50 concurrent register requests from eligible students, exactly 1 is REGISTERED/PENDING and 49 receive `SECTION_FULL` (or waitlisted if requested); `enrolledCount` = 1. |
| AC-REG-002 | A student lacking a prerequisite receives `PREREQUISITE_NOT_MET` with the missing course codes in `error.details`. |
| AC-REG-003 | A registration that would exceed max credits returns `CREDIT_LIMIT_EXCEEDED` with current, attempted and max values. |
| AC-REG-004 | An overlapping meeting returns `TIMETABLE_CONFLICT` naming the conflicting section. |
| AC-REG-005 | Dropping a REGISTERED seat in a full section with a waitlist results in the first eligible waitlisted student being REGISTERED within the job's processing time, and both students are notified. |
| AC-REG-006 | Double submission with the same idempotency key creates exactly one registration. |
| AC-AUTH-001 | Reusing a rotated refresh token outside the grace window revokes the session; subsequent refreshes fail with `SESSION_REVOKED`. |
| AC-AUTH-002 | Six wrong passwords lock the account; the response for the locked account is generic. |
| AC-AUTH-003 | Forgot-password responses are byte-identical for existing and non-existing emails. |
| AC-RBAC-001 | A department admin receives 404/403 when updating a course of another department. |
| AC-RBAC-002 | A faculty member cannot read the roster of a section they do not teach. |
| AC-COMM-001 | A student cannot start a direct conversation with a faculty member who does not teach any of their current sections (when the setting is restrictive). |
| AC-COMM-002 | A faculty announcement targeted to their section is visible to registered students of that section and not to others. |
| AC-ADMIN-001 | Dashboard totals equal the corresponding DB counts for the seeded dataset. |

## 38. Edge Cases

Captured with handling rules:

| Case | Handling |
|---|---|
| Concurrent last-seat registration | Row lock + check constraint (FR-REG-014) |
| Duplicate submission / double-click | Idempotency key + partial unique index |
| Student registered in two sections of same course | Partial unique index (student, course, session) on seat-holding statuses |
| Prerequisite in progress | Policy flag `allowInProgressPrereqs`; if the prereq is later failed, a job flags the dependent registration for admin review (no auto-drop) |
| Corequisite pair registered together | Batch evaluates the pair jointly |
| Credit limit with waitlist entries | Configurable (BR-017). On promotion the limit is re-checked |
| Promotion candidate now has a conflict | Skipped with `WAITLIST_SKIPPED` notification; stays on waitlist unless policy removes them |
| Section cancelled with waitlist | All entries CANCELLED and notified |
| Capacity reduced below enrollment | Rejected (BR-004) |
| Instructor deactivated | FR-USER-009 |
| Section without instructor | BR-014 |
| Program change mid-session | BR-011 |
| Registration attempt outside window | `REGISTRATION_PERIOD_CLOSED` / `REGISTRATION_NOT_YET_OPEN` with open time |
| Deadline time zone | Deadlines are stored in UTC but authored/displayed in the university time zone; boundaries are inclusive to the minute |
| Session dates changed while active | BR-020 |
| Student suspended with waitlist entries | Entries remain but are skipped at promotion; removed if the suspension persists at period close |
| Token stolen and refreshed by attacker | Reuse detection revokes family |
| Clock skew on JWT | 30 s leeway |
| Large roster export | Background job |
| Empty states (new university, no sessions) | Onboarding checklist on admin dashboard |
| Deleted/renamed course with history | Courses cannot be deleted once sections exist; code changes are audited; academic records snapshot code/title/credits at completion |

## 39. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-01 | Scope is very large for one build | Phased roadmap; foundational versions of attendance/assessments; explicit "planned" marking |
| R-02 | Registration load spikes | Row-level locking per section (not global), Redis rate limit per student, catalog cache, horizontal API scaling |
| R-03 | Hot-row contention on popular sections | Short transactions; rule evaluation done before locking, only the capacity check inside the lock; re-validate cheap rules inside |
| R-04 | Permission complexity leads to leaks | Central policy layer + scope resolver + permission tests per endpoint |
| R-05 | Docker not available on the dev machine | Native PostgreSQL/Redis path documented; Docker Compose for CI and production |
| R-06 | Waitlist job failure leaves seats unfilled | Retries, idempotent processing, and a periodic sweeper job that reconciles free seats vs waitlists |
| R-07 | Drift between documentation and implementation | Roadmap checklist updated each phase; docs reviewed in the phase exit criteria |

## 40. Future Enhancements

Multi-tenancy; SSO (SAML/OIDC) with the institutional IdP; fee/billing integration; LMS integration (LTI); degree audit "what-if" for program changes; timetable auto-generation (constraint solver); room booking for events; mobile app/PWA push notifications; analytics warehouse; transcript PDF generation with digital signatures; exam scheduling; course evaluation surveys; parent/guardian access; i18n translations; accessibility audit by third party.
