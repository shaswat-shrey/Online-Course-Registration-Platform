# University Course Registration & Academic Management System (UCRAMS)

A full-stack platform for managing a university's academic structure, course catalog, course sections, faculty assignments, student registration (with waitlists and concurrency-safe seat allocation), communication, and reporting, through Administrator, Faculty and Student portals.

> **Project status: complete (Phases 0–13).** Every module in the specification is implemented, tested and documented. Build history and decisions: [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## What works today

- **Authentication:** email/password sign-in (Argon2id), account lockout, login history, forgot/reset password, invitation acceptance, change password, per-device sessions with revoke and "sign out everywhere". Short-lived access tokens plus rotating HttpOnly refresh cookies with reuse detection and CSRF protection.
- **Access control:** six system roles with 74 granular permissions, scoped assignments (university / faculty-school / department), relationship-scoped faculty and student roles, custom roles, a privilege-escalation guard, and server-side enforcement on every route (default deny).
- **University structure:** university profile and campuses, faculties/schools, departments, degrees, programs with requirement groups, and specializations. Department admins manage only their own department; nothing in use can be deleted, and nothing with active children can be deactivated.
- **Academic calendar:** academic years and sessions with a lifecycle (planned → active → completed → archived) and a current session per type, per-session registration policy (credit limits, approvals, waitlists), registration periods and deadlines in the university's time zone, priority windows, and configurable grading scales.
- **People:** student records (program, specialization, year, status, contact details, program-change history), registration holds, faculty records (designation, primary and joint departments, office, load limit, heads of department and deans) with a public directory, and administrator profiles. Accounts are created with invitation emails; admins can suspend, reactivate, deactivate, unlock and re-invite within their scope. Student and employee numbers are generated.
- **Course catalog:** courses with credits, level, category, outcomes, assessment structure and syllabus; ranked full-text search; prerequisites as AND-of-OR groups with minimum grades (cycles rejected); corequisites; core/elective mappings to programs and specializations; include/exclude restrictions by department, program, specialization or year; course lists for program requirements.
- **Sections and scheduling:** sections per session with capacity and waitlist size, weekly meetings in classrooms, primary and co-instructors, classroom and instructor conflict detection with audited overrides, teaching-load warnings, publish/close/reopen/cancel/complete, and copying a whole session's sections into the next. Classrooms with weekly occupancy views.
- **Registration engine:** every rule from the SRS (holds, registration windows with priority windows, prerequisites with minimum grades, corequisites, restrictions, credit limits, timetable clashes, seats) checked in one pipeline that powers the eligibility preview and registration; concurrency-safe seat allocation with idempotent submissions; approvals (including cross-department and late registration), drop/withdraw with deadlines, administrative registration with audited per-rule overrides; waitlists with automatic promotion or time-limited seat offers; section cancellation cascades; in-app notifications; academic records with CGPA; course plans.
- **Bulk import:** CSV or Excel uploads of students or faculty with a row-by-row preview (format, unknown codes, duplicates, scope), then background creation with a per-row report and optional invitations.
- **Administration portal:** overview, the structure, calendar, catalog, registration and people pages above (registrations, approvals, waitlists), imports, roles and permissions (permission editing for super admins), audit log with filters, and account security with a profile photo.
- **Faculty portal:** teaching dashboard (today's classes, weekly schedule, load), teaching assignments, and a workspace per section with the roster (CSV export, academic student profiles), course materials (uploads and links, published to registered students only) and section announcements that notify the class.
- **Student portal:** dashboard, course catalog with filters and personal prerequisite status, eligibility check and registration (or waitlist/request), my registrations with drop/withdraw/claim actions by deadline, course planner with rule checks and one-click registration, weekly timetable with calendar export, degree progress by requirement group, academic history with GPA, announcements and course pages with materials.
- **Communication:** real-time messaging (direct, section chats synced with the roster, and a support inbox for administrators) with attachments, edits, search and unread badges; section discussion boards with accepted answers; announcements to any audience (everyone, roles, schools, departments, programmes, specializations, courses, sections, years, people) with scheduling, expiry and read tracking; notification preferences with email delivery; feedback and support tickets with internal notes, status history and reopening.
- **Academic management:** attendance registers, assessments with a weighted gradebook, final grade submission → approval → posting into academic records, versioned grade changes, transcripts with a configurable GPA repeat policy, and room availability.
- **Analytics and reporting:** a scoped, cached administrator dashboard with charts and alerts, fifteen reports with server-side filters, sorting and paging, and CSV/Excel exports (large ones in the background).
- **Platform:** health checks, the public university profile, Swagger docs at `/api/docs`, a BullMQ worker (email, imports, exports, waitlist, announcements, maintenance), S3-compatible or local file storage, authenticated Socket.IO, audit log, rate limits, and a reviewed security posture ([docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md)).

## Documentation

| Document                                                                 | Contents                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [docs/SRS.md](docs/SRS.md)                                               | Software Requirements Specification (requirement IDs, business rules, use cases, acceptance criteria)         |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                             | System, backend, frontend, auth, RBAC, registration engine, Redis, queues, sockets, storage, deployment, ADRs |
| [docs/DATABASE.md](docs/DATABASE.md)                                     | ERDs, tables, constraints, indexes, transaction strategies, migrations, seed plan                             |
| [docs/API.md](docs/API.md)                                               | API conventions, envelope, error codes, endpoint groups, rate limits                                          |
| [docs/USER_ROLES_AND_PERMISSIONS.md](docs/USER_ROLES_AND_PERMISSIONS.md) | Roles, permission catalogue, matrix, messaging/announcement rules                                             |
| [docs/SECURITY.md](docs/SECURITY.md)                                     | Threat model, controls, OWASP mapping, implementation checklist                                               |
| [docs/TESTING.md](docs/TESTING.md)                                       | Test strategy, mandatory coverage, E2E journeys                                                               |
| [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md)                       | Phase 12 OWASP review, findings and fixes                                                                     |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                                 | Production deployment, upgrades, backups and restore, monitoring, production checklist                        |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md)               | Phases, task checklists, decisions, open questions                                                            |

## Technology stack

- **Frontend:** React 19, TypeScript, Vite 8, React Router 8, TanStack Query, Zustand, Tailwind CSS 4, shadcn/ui, React Hook Form, Zod, Recharts, Socket.IO client, Axios
- **Backend:** Node.js 24, Express 5, TypeScript 6, Prisma 7 (pg driver adapter), PostgreSQL, Redis, BullMQ, Socket.IO, Zod 4, OpenAPI 3.1 (zod-to-openapi) + Swagger UI, Pino
- **Infrastructure:** Docker Compose (PostgreSQL, Redis, Mailpit), Nginx
- **Testing:** Vitest, Supertest, React Testing Library + MSW, Playwright

## Repository layout

```
apps/api         Express API (src/server.ts) and BullMQ worker (src/worker.ts)
  prisma/        schema, migrations, seed
  src/config     env validation, logger
  src/common     errors, middleware, defineRoute helper, response helpers
  src/infrastructure  database, redis, queues, storage, email, sockets
  src/modules    feature modules (auth, rbac, structure, people, courses, sections,
                 registrations, teaching, messaging, announcements, academics, reports, …)
apps/web         React SPA (features/, components/, app/ router + providers)
packages/shared  Zod schemas, permission/role catalogue, error codes and helpers shared by API and web
e2e/             Playwright specs
docker/          Dockerfiles, nginx.conf, postgres init
load/            k6 registration load test
scripts/         Operations scripts (database backup)
docs/            Project documentation
```

## Prerequisites

Install these on the machine where you clone the repository:

| Software                                                          | Version                                                                  | Why                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Git](https://git-scm.com/)                                       | any recent                                                               | Clone the repository                                                                 |
| [Node.js](https://nodejs.org/)                                    | **22.12 or newer** (24 recommended, see `.nvmrc`) — includes **npm 10+** | Runs the API, worker, web build and tooling                                          |
| [PostgreSQL](https://www.postgresql.org/download/)                | **16 or newer** (17 recommended)                                         | Main database                                                                        |
| [Redis](https://redis.io/download/)                               | **7 or newer**                                                           | Queues, caches, rate limits, real-time fan-out                                       |
| Playwright Chromium                                               | installed by `npx playwright install chromium`                           | Only for end-to-end tests                                                            |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | optional                                                                 | Provides PostgreSQL, Redis and Mailpit in one command, and the production-like stack |
| [k6](https://k6.io/docs/get-started/installation/)                | optional                                                                 | Only for the registration load test                                                  |

You do **not** install application libraries (React, Express, Prisma, …) by hand: `npm install` downloads every package listed in the `package.json` files.

Database and Redis, pick one:

- **Docker:** `docker compose up -d` (creates the `ucrams` user and the `ucrams_dev` / `ucrams_test` databases), **or**
- **native**, e.g. macOS: `brew install postgresql@17 redis && brew services start postgresql@17 && brew services start redis`; Ubuntu/Debian: `sudo apt install postgresql redis-server`; Windows: the PostgreSQL installer and Redis via WSL or Docker.

## Installation

```bash
git clone https://github.com/shaswat-shrey/Online-Course-Registration-Platform.git
cd Online-Course-Registration-Platform
npm install
cp apps/api/.env.example apps/api/.env
```

### Database setup

**With Docker:**

```bash
docker compose up -d
```

This creates the `ucrams` role, the `ucrams_dev` database, and the `ucrams_test` database.

**Native PostgreSQL:** create the role and databases once:

```bash
psql -d postgres -c "CREATE ROLE ucrams LOGIN PASSWORD 'ucrams_dev_password' CREATEDB;"
createdb -O ucrams ucrams_dev && createdb -O ucrams ucrams_test
```

### Migrations and seed

```bash
npm run db:migrate   # prisma migrate dev (creates/applies migrations)
npm run db:seed      # idempotent; safe to run repeatedly
```

Other database commands: `npm run db:deploy` (apply migrations without prompting, used in CI and production) and `npm run db:studio`.

## Running

```bash
npm run dev
```

This starts the shared package watcher, the API (http://localhost:4000), the worker, and the web app (http://localhost:5173). The web dev server proxies `/api` and `/socket.io` to the API, so the browser uses a single origin.

| URL                                       | What                           |
| ----------------------------------------- | ------------------------------ |
| http://localhost:5173                     | Web app                        |
| http://localhost:4000/api/docs            | Swagger UI                     |
| http://localhost:4000/api/v1/health/ready | Readiness (DB, Redis, storage) |

Run parts individually with `npm run dev -w @ucrams/api`, `npm run dev:worker -w @ucrams/api`, or `npm run dev -w @ucrams/web`.

## Environment variables

All API variables are documented in [apps/api/.env.example](apps/api/.env.example) and validated at startup by [apps/api/src/config/env.ts](apps/api/src/config/env.ts). The process exits with a list of problems if any value is invalid. With `NODE_ENV=production`, the API also refuses example secrets and requires `API_DOCS_ENABLED=false`.

Key choices for local development:

- `STORAGE_DRIVER=local` stores files under `apps/api/storage/` and serves HMAC-signed URLs. Use `s3` with any S3-compatible service (AWS S3, Cloudflare R2) in production.
- `MAIL_TRANSPORT=log` renders emails and logs them without sending. Use `smtp` with Mailpit (http://localhost:8025) to inspect real messages.

The web app reads `VITE_API_BASE_URL` (default `/api/v1`) and, in development, `VITE_API_PROXY_TARGET` (default `http://localhost:4000`).

## Tests and checks

| Command                                | What it runs                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm test`                             | Unit + integration tests for all workspaces (API tests use `ucrams_test` and Redis DB 15) |
| `npm run test:api`                     | API tests only                                                                            |
| `npm run test:web`                     | Web tests only (jsdom + MSW)                                                              |
| `npm run test:e2e`                     | Playwright on desktop and mobile; starts `npm run dev` unless it is already running       |
| `npm run test:coverage -w @ucrams/api` | API coverage report (V8)                                                                  |
| `npm run typecheck`                    | TypeScript across all workspaces                                                          |
| `npm run lint`                         | ESLint                                                                                    |
| `npm run format:check`                 | Prettier                                                                                  |

The first E2E run needs a browser: `npx playwright install chromium`. API test configuration lives in [apps/api/.env.test](apps/api/.env.test).

## Docker (production-like stack)

```bash
cp .env.docker.example .env      # set strong values for every secret
docker compose --profile app up -d --build
```

This builds the `api`, `worker` and `web` images, runs `prisma migrate deploy` as a one-off `migrate` service, and serves the app at http://localhost:8080 (Nginx serves the SPA and proxies `/api` and `/socket.io`). The containers run with `NODE_ENV=production`, so example secrets are rejected.

Compose refuses to start the app profile until `JWT_ACCESS_SECRET`, `STORAGE_SIGNING_SECRET` and `MFA_ENCRYPTION_KEY` are set. Create the first administrator with `docker compose --profile app run --rm -e BOOTSTRAP_ADMIN_EMAIL=… -e BOOTSTRAP_ADMIN_FIRST_NAME=… -e BOOTSTRAP_ADMIN_LAST_NAME=… api node apps/api/dist/bootstrap-admin.js`. Full production guidance (TLS, backups, monitoring, checklist): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

> Docker was not available on the development machine, so the images and the Compose stack were validated by CI's image build and by running the compiled API and worker with the same production environment, not by `docker compose up` locally.

## Development credentials

`npm run db:seed` creates the university structure (9 faculties, 32 departments, 16 degrees, 32 programs, 33 specializations), the 2025–2027 academic calendar, example grading scales, 129 faculty members (with heads and deans), 1,669 students (some with holds), 105 classrooms, 272 courses with prerequisites, sections for every session, about 7,500 registrations (graded history, current timetables, and Spring 2027 registration open now with waitlists and pending approvals), and one account per role. The dev faculty and student accounts are linked to records `FAC09001` and `25CS9001`. All use the password in `SEED_DEV_PASSWORD` (`apps/api/.env`; the example value is `Ucrams-Dev-Pass-2026`). **Development only:** the seed refuses to run with `NODE_ENV=production`.

| Role                                             | Email                     | Lands on             |
| ------------------------------------------------ | ------------------------- | -------------------- |
| Super Administrator                              | `superadmin@ucrams.local` | `/admin/dashboard`   |
| University Administrator                         | `uniadmin@ucrams.local`   | `/admin/dashboard`   |
| Academic Administrator                           | `registrar@ucrams.local`  | `/admin/dashboard`   |
| Department Administrator (Computer Science only) | `cs.admin@ucrams.local`   | `/admin/dashboard`   |
| Faculty Member                                   | `faculty.cs@ucrams.local` | `/faculty/dashboard` |
| Student                                          | `student.cs@ucrams.local` | `/student/dashboard` |

To restore system roles to their default permissions after experimenting: `npx tsx prisma/seed/index.ts --reset-roles` (run in `apps/api`).

Without email delivery configured (`MAIL_TRANSPORT=log`), reset and invitation emails are rendered and logged by the **worker**, so the links appear in its output.

### First administrator in production

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@your-university.edu BOOTSTRAP_ADMIN_FIRST_NAME=Ada BOOTSTRAP_ADMIN_LAST_NAME=Admin npm run bootstrap:admin -w @ucrams/api
```

This syncs the permission catalogue and creates an invited Super Administrator. It prints a one-time activation link and also emails it. It does nothing if a Super Administrator already exists. From a build (no dev tools), use `npm run start:bootstrap-admin -w @ucrams/api`.

## Troubleshooting

| Symptom                                                   | Fix                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| API exits with `Invalid environment configuration`        | Read the listed variables; compare with `apps/api/.env.example`.                                                                                |
| `/health/ready` reports `redis: down`                     | Start Redis (`brew services start redis` or `docker compose up -d redis`).                                                                      |
| Web shows "Status unavailable" / Vite logs `ECONNREFUSED` | The API is not running on `API_PORT` (default 4000). The API reads `API_PORT`, not `PORT`, so tools that export `PORT` don't move it.           |
| `Cannot find module '../../generated/prisma/client.js'`   | Run `npm run db:generate -w @ucrams/api` (the client is generated, not committed).                                                              |
| Prisma `P1001` / connection refused                       | PostgreSQL isn't running or `DATABASE_URL` is wrong.                                                                                            |
| `npm ls` reports `effect` as invalid                      | Expected: a root `overrides` entry pins a patched `effect` for Prisma's config loader (security fix). See the roadmap's technical-debt section. |
