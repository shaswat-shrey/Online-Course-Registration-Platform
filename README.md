# University Course Registration & Academic Management System (UCRAMS)

A full-stack platform for managing a university's academic structure, course catalog, course sections, faculty assignments, student registration (with waitlists and concurrency-safe seat allocation), communication, and reporting, through Administrator, Faculty and Student portals.

> **Project status: Phase 0 (planning) complete — no application code yet.**
> Setup, run and test instructions below are **planned** and will be filled in as Phase 1 is implemented. Progress is tracked in [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/SRS.md](docs/SRS.md) | Software Requirements Specification (requirement IDs, business rules, use cases, acceptance criteria) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System, backend, frontend, auth, RBAC, registration engine, Redis, queues, sockets, storage, deployment, ADRs |
| [docs/DATABASE.md](docs/DATABASE.md) | ERDs, tables, constraints, indexes, transaction strategies, migrations, seed plan |
| [docs/API.md](docs/API.md) | API conventions, envelope, error codes, endpoint groups, rate limits |
| [docs/USER_ROLES_AND_PERMISSIONS.md](docs/USER_ROLES_AND_PERMISSIONS.md) | Roles, permission catalogue, matrix, messaging/announcement rules |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, OWASP mapping, implementation checklist |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, mandatory coverage, E2E journeys |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | Phases, task checklists, decisions, open questions |

## Technology stack

- **Frontend:** React, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, shadcn/ui, React Hook Form, Zod, Recharts, Socket.IO client, Axios
- **Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO, JWT + rotating refresh tokens, Zod, OpenAPI/Swagger, Pino
- **Infrastructure:** Docker Compose (PostgreSQL, Redis, MinIO, Mailpit), Nginx
- **Testing:** Vitest, Supertest, React Testing Library, Playwright

## Repository layout (planned)

```
apps/api        Express API + BullMQ worker (two entry points)
apps/web        React SPA
packages/shared Zod schemas, enums, permission keys, error codes
docs/           Project documentation
```

## Getting started

_Planned for Phase 1._ Prerequisites will be Node.js 22+, npm 10+, and either Docker (recommended) or local PostgreSQL 16+ and Redis 7+.
