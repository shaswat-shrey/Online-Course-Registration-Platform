# API Design

> Status: **design (Phase 0)**. Endpoints are implemented phase by phase; the live OpenAPI document at `/api/docs` is authoritative once it exists. Every endpoint listed here is *planned* until the roadmap marks its phase done.

## 1. Conventions

- Base path: `/api/v1`. Breaking changes → `/api/v2`. Additive changes stay in v1.
- JSON only (`Content-Type: application/json`), except file uploads (presigned, direct to storage) and exports (file download).
- Resource names: plural, kebab-case (`/course-sections`). IDs are UUIDs.
- Nested routes only for strong ownership (`/course-sections/{id}/meetings`). Otherwise use filters (`/registrations?sectionId=`).
- Actions that are not CRUD use sub-resource verbs: `POST /course-sections/{id}/publish`, `POST /registrations/{id}/drop`.
- Timestamps: ISO 8601 UTC (`2026-11-20T10:00:00.000Z`). Times of day: `"HH:mm"`. Dates: `"YYYY-MM-DD"`.
- Field names: camelCase.

## 2. Authentication

- `Authorization: Bearer <accessToken>` on every endpoint except `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/accept-invite`, `/health/*`.
- Refresh token: HttpOnly cookie `ucrams_rt` (path `/api/v1/auth`). Refresh and logout also require header `X-CSRF-Token` equal to the `ucrams_csrf` cookie.
- `401` codes: `UNAUTHENTICATED`, `TOKEN_EXPIRED` (client should refresh), `SESSION_REVOKED` (client must re-login).

## 3. Response envelope

Success:
```json
{
  "success": true,
  "message": "Courses retrieved successfully",
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```
`meta` is present only on paginated lists. `data` is an object for single resources.

Error:
```json
{
  "success": false,
  "message": "Course registration failed",
  "error": {
    "code": "PREREQUISITE_NOT_MET",
    "details": { "missing": [{ "anyOf": ["CS101", "CS102"] }] },
    "requestId": "01JD…"
  }
}
```
Validation errors use `code: "VALIDATION_ERROR"` with `details.fields: [{ path: "body.credits", message: "…" }]`.

No stack traces, SQL, Prisma error text or internal IDs of unrelated entities are ever returned. `requestId` correlates with server logs.

## 4. Pagination, sorting, filtering, search

| Param | Example | Notes |
|---|---|---|
| `page` | `1` | 1-based, default 1 |
| `limit` | `20` | default 20, max 100 |
| `sort` | `code:asc,createdAt:desc` | allow-listed fields per endpoint; unknown field → 400 |
| `q` | `data struct` | full-text / trigram search where supported |
| filters | `departmentId=…&status=ACTIVE&credits[gte]=3` | documented per endpoint; arrays as repeated params `status=A&status=B` |

Message lists and notifications use cursor pagination (`cursor`, `limit`) and return `meta: { nextCursor }`.

## 5. HTTP status codes

| Status | Use |
|---|---|
| 200 / 201 / 204 | OK / Created / No content |
| 400 | `VALIDATION_ERROR`, `INVALID_SORT_FIELD` |
| 401 | Authentication problems |
| 403 | `FORBIDDEN` (authenticated, lacking permission, resource visible) |
| 404 | `NOT_FOUND` (also used when the resource exists but the caller may not know it exists) |
| 409 | `CONFLICT`, `DUPLICATE_REGISTRATION`, `SECTION_FULL`, `UNIQUE_VIOLATION`, `STALE_UPDATE` |
| 422 | Business rule violations (registration rules, state transitions) and validation that depends on stored data (e.g. credit budgets, dates within a session, inactive parents), with `details.fields` when a field is responsible. Pure schema validation is 400. |
| 423 | `ACCOUNT_LOCKED` (only after successful credential check, to avoid enumeration; otherwise generic 401) |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` (readiness failure, maintenance) |

## 6. Error code catalogue (initial)

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input failed schema validation |
| `UNAUTHENTICATED` | 401 | No/invalid credentials |
| `INVALID_CREDENTIALS` | 401 | Login failed (generic; also used for unknown email) |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `SESSION_REVOKED` | 401 | Session revoked or token reuse detected |
| `MFA_REQUIRED` | 401 | Second factor required |
| `ACCOUNT_LOCKED` | 423 | Lockout active |
| `ACCOUNT_INACTIVE` | 403 | Suspended/deactivated |
| `FORBIDDEN` | 403 | Missing permission/scope |
| `NOT_FOUND` | 404 | |
| `CONFLICT` | 409 | Generic conflict |
| `UNIQUE_VIOLATION` | 409 | Duplicate code/email etc. (`details.fields`) |
| `STALE_UPDATE` | 409 | Optimistic concurrency (`updatedAt` mismatch) |
| `INVALID_STATE_TRANSITION` | 422 | e.g. publish a cancelled section |
| `STUDENT_NOT_ACTIVE` | 422 | Registration rule |
| `REGISTRATION_HOLD` | 422 | Registration rule |
| `REGISTRATION_NOT_YET_OPEN` | 422 | `details.opensAt` |
| `REGISTRATION_PERIOD_CLOSED` | 422 | |
| `ADD_DROP_DEADLINE_PASSED` | 422 | |
| `WITHDRAWAL_DEADLINE_PASSED` | 422 | |
| `SECTION_NOT_AVAILABLE` | 422 | |
| `DUPLICATE_REGISTRATION` | 409 | |
| `COURSE_ALREADY_COMPLETED` | 422 | |
| `PREREQUISITE_NOT_MET` | 422 | `details.missing` |
| `COREQUISITE_NOT_MET` | 422 | `details.missing` |
| `COREQUISITE_DEPENDENCY` | 422 | Dropping a course another registration depends on |
| `RESTRICTION_NOT_MET` | 422 | `details.restriction` |
| `CREDIT_LIMIT_EXCEEDED` | 422 | `details.{current,attempted,max}` |
| `TIMETABLE_CONFLICT` | 422 | `details.conflicts[]` |
| `SECTION_FULL` | 409 | `details.waitlistAvailable` |
| `WAITLIST_FULL` | 409 | |
| `WAITLIST_DISABLED` | 422 | |
| `CAPACITY_BELOW_ENROLLMENT` | 422 | |
| `CLASSROOM_CONFLICT` / `INSTRUCTOR_CONFLICT` | 409 | `details.conflicts[]` |
| `PREREQUISITE_CYCLE` | 422 | |
| `FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` / `FILE_NOT_READY` | 422 | |
| `MESSAGING_NOT_ALLOWED` | 403 | Conversation rule |
| `RATE_LIMITED` | 429 | |
| `INTERNAL_ERROR` | 500 | |

## 7. Endpoint groups

The table lists the main endpoints per group. Standard CRUD = `GET /x` (list), `POST /x`, `GET /x/{id}`, `PATCH /x/{id}`, `DELETE /x/{id}` (only where deletion is allowed; otherwise `POST /x/{id}/deactivate` / `activate`).

| Group | Endpoints |
|---|---|
| **Health** | `GET /health/live`, `GET /health/ready` (implemented, Phase 1) |
| **Auth** (implemented, Phase 2, except MFA and verify-email) | `POST /auth/login`, `POST /auth/mfa/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/accept-invite`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/login-history` |
| **Users** (implemented in Phase 2: `GET/POST /users/{id}/roles`, `DELETE /users/{id}/roles/{assignmentId}`, `GET/DELETE /users/{id}/sessions`, `GET /users/{id}/login-history`, `POST /users/{id}/unlock`) | CRUD `/users`, `POST /users/{id}/suspend|reactivate|deactivate|unlock`, `GET/POST/DELETE /users/{id}/roles`, `GET /users/{id}/sessions`, `DELETE /users/{id}/sessions`, `POST /users/{id}/resend-invite` |
| **RBAC** (implemented, Phase 2) | `GET /roles`, `POST /roles`, `PATCH /roles/{id}`, `DELETE /roles/{id}`, `PUT /roles/{id}/permissions`, `GET /permissions` |
| **Students** | CRUD `/students`, `GET /students/me`, `PATCH /students/me`, `POST /students/{id}/change-program`, `GET /students/{id}/registrations`, `GET /students/{id}/progress`, `GET /students/{id}/records`, `GET/POST /students/{id}/holds`, `POST /holds/{id}/release`, `POST /students/imports` (multipart CSV/XLSX → ImportJob), `GET /imports/{id}` |
| **Faculty** | CRUD `/faculty`, `GET /faculty/me`, `PATCH /faculty/me`, `GET /faculty/{id}/schedule`, `GET /faculty/{id}/workload`, `POST /faculty/imports` |
| **Administrators** | CRUD `/administrators` |
| **University** (implemented, Phase 3) | `GET /university/public`, `GET/PATCH /university`, `GET/POST /campuses`, `PATCH/DELETE /campuses/{id}` |
| **Schools** (implemented, Phase 3) | `GET/POST /schools` (search `q`, `status`, sort, pagination), `GET/PATCH/DELETE /schools/{id}` (detail includes counts) |
| **Departments** (implemented, Phase 3) | `GET/POST /departments` (`q`, `status`, `schoolId`), `GET/PATCH/DELETE /departments/{id}`; responses carry `canManage` |
| **Degrees** (implemented, Phase 3) | `GET/POST /degrees` (`level`, `status`), `PATCH/DELETE /degrees/{id}` |
| **Programs** (implemented, Phase 3) | `GET/POST /programs` (`q`, `status`, `departmentId`, `schoolId`, `degreeId`, `level`), `GET/PATCH/DELETE /programs/{id}` (detail includes specializations and requirement groups), `POST /programs/{id}/requirement-groups`, `PUT/DELETE /requirement-groups/{id}` |
| **Specializations** (implemented, Phase 3) | `GET /programs/{id}/specializations`, `POST /specializations`, `PATCH/DELETE /specializations/{id}`, `POST /specializations/{id}/requirement-groups` |
| **Academic calendar** (implemented, Phase 3) | `GET/POST /academic-years`, `PATCH/DELETE /academic-years/{id}`, `GET/POST /academic-sessions` (`academicYearId`, `status`, `current`), `GET/PATCH/DELETE /academic-sessions/{id}`, `POST /academic-sessions/{id}/transition` (`activate`, `complete`, `archive`, `make-current`), `PUT /academic-sessions/{id}/policy`, `PUT /academic-sessions/{id}/registration-period`, `POST/DELETE /academic-sessions/{id}/priority-windows[/{windowId}]`; session responses include policy, period and computed `registrationState` |
| **Grading scales** (implemented, Phase 3) | `GET/POST /grading-scales`, `GET/PUT/DELETE /grading-scales/{id}` (bands locked once a completed session uses the scale) |
| **Classrooms** | CRUD `/classrooms`, `GET /classrooms/{id}/schedule?sessionId=` |
| **Courses** | CRUD `/courses`, `GET /courses/{id}/sections`, `PUT /courses/{id}/prerequisites`, `PUT /courses/{id}/corequisites`, `PUT /courses/{id}/programs`, `PUT /courses/{id}/specializations`, `PUT /courses/{id}/restrictions`, `GET /catalog` (student-facing search over published sections) |
| **Course sections** | CRUD `/course-sections`, `PUT /course-sections/{id}/meetings`, `PUT /course-sections/{id}/instructors`, `POST /course-sections/{id}/publish|close|reopen|cancel`, `GET /course-sections/{id}/roster`, `GET /course-sections/{id}/roster/export`, `GET /course-sections/{id}/stats`, `POST /course-sections/roll-forward` |
| **Registrations** | `GET /registrations/eligibility?sectionId=`, `POST /registrations` (Idempotency-Key), `POST /registrations/batch`, `GET /registrations` (scoped; students see own), `GET /registrations/{id}`, `POST /registrations/{id}/drop`, `POST /registrations/{id}/withdraw`, `POST /registrations/{id}/cancel`, `POST /registrations/{id}/approve`, `POST /registrations/{id}/reject`, `POST /registrations/bulk-approve`, `GET /registrations/{id}/history`, `POST /admin/registrations` (on behalf, with overrides) |
| **Waitlist** | `POST /waitlist` (join), `DELETE /waitlist/{registrationId}`, `POST /waitlist/{registrationId}/claim`, `GET /course-sections/{id}/waitlist`, `POST /course-sections/{id}/waitlist/promote` |
| **Planner** | CRUD `/course-plans`, `PUT /course-plans/{id}/items`, `GET /course-plans/{id}/validate`, `POST /course-plans/{id}/register` |
| **Timetables** | `GET /timetables/me?sessionId=`, `GET /timetables/sections/{id}`, `GET /timetables/faculty/{id}`, `GET /timetables/classrooms/{id}`, `GET /timetables/me.ics` (S) |
| **Attendance** | `GET/POST /course-sections/{id}/attendance-sessions`, `PUT /attendance-sessions/{id}/records`, `GET /attendance/me?sectionId=`, `GET /course-sections/{id}/attendance/report` |
| **Assessments** | CRUD `/course-sections/{id}/assessments`, `PUT /assessments/{id}/scores`, `POST /assessments/{id}/publish`, `GET /assessments/me?sectionId=` |
| **Grades** | `GET/PUT /course-sections/{id}/final-grades`, `POST /course-sections/{id}/final-grades/submit|approve|post`, `POST /academic-records/{id}/grade-change` |
| **Academic records** | `GET /academic-records/me`, `GET /students/{id}/records`, `POST /students/{id}/records` (transfer/exemption), `GET /students/{id}/transcript` |
| **Announcements** | CRUD `/announcements`, `POST /announcements/{id}/publish|unpublish|pin`, `GET /announcements/feed` (resolved for current user), `POST /announcements/{id}/read` |
| **Messaging** | `GET /conversations`, `POST /conversations` (direct), `GET /conversations/{id}`, `GET /conversations/{id}/messages?cursor=`, `POST /conversations/{id}/messages`, `PATCH /messages/{id}`, `DELETE /messages/{id}`, `POST /conversations/{id}/read`, `GET /conversations/unread-count`, `GET /messages/search?q=`, `GET /messaging/contacts` (who the user may message) |
| **Discussions** | `GET/POST /course-sections/{id}/threads`, `GET /threads/{id}`, `POST /threads/{id}/posts`, `PATCH /threads/{id}` (pin/lock), `POST /posts/{id}/accept` |
| **Notifications** | `GET /notifications?cursor=&unread=`, `GET /notifications/unread-count`, `POST /notifications/read` (ids or all), `GET/PUT /notifications/preferences` |
| **Feedback** | CRUD `/feedback` (scoped), `POST /feedback/{id}/responses`, `POST /feedback/{id}/assign`, `POST /feedback/{id}/status` |
| **Support tickets** | CRUD `/tickets`, `POST /tickets/{id}/responses`, `POST /tickets/{id}/assign`, `POST /tickets/{id}/status`, `GET /tickets/{id}/events` |
| **Files / documents** | `POST /files/upload-intents`, `POST /files/{id}/complete`, `GET /files/{id}/download`, `DELETE /files/{id}`, CRUD `/course-sections/{id}/materials`, CRUD `/documents` |
| **Search** | `GET /search?q=&types=course,department,program,specialization,faculty,student` |
| **Dashboards** | `GET /dashboards/admin?filters…`, `GET /dashboards/faculty`, `GET /dashboards/student` |
| **Reports** | `GET /reports` (catalogue), `GET /reports/{reportKey}?filters…`, `POST /reports/{reportKey}/export {format}` → ExportJob, `GET /exports/{id}` |
| **Settings** | `GET /settings`, `PATCH /settings/{key}` |
| **Audit logs** | `GET /audit-logs` (implemented, Phase 2; filters `action` prefix, `entityType`, `entityId`, `actorId`, `from`, `to`), `GET /audit-logs/{id}`, `POST /audit-logs/export` |
| **Jobs** | `GET /jobs/failed`, `POST /jobs/{queue}/{id}/retry` |

## 8. Idempotency

`POST /registrations`, `/registrations/batch`, `/course-plans/{id}/register`, `/waitlist` accept `Idempotency-Key` (UUID). The first response for `(userId, key)` is cached for 24 h; replays return it with header `Idempotent-Replay: true`. Reusing a key with a different body → `409 CONFLICT`.

## 9. Optimistic concurrency for admin edits

`PATCH` bodies for structure/course/section entities may include `expectedUpdatedAt`. If the row changed since, the API returns `409 STALE_UPDATE` so two admins don't silently overwrite each other.

## 10. Rate limits (defaults)

| Bucket | Limit |
|---|---|
| Global per IP | 300 req / min |
| `POST /auth/login` | 10 / 15 min per IP+identifier; 50 / 15 min per IP |
| `POST /auth/refresh` | 60 / 15 min per session |
| `POST /auth/forgot-password` | 5 / hour per identifier, 20 / hour per IP |
| Registration writes | 30 / min per student |
| Message send | 60 / min per user |
| Search | 60 / min per user |
| Export requests | 10 / hour per user |

## 11. Swagger / OpenAPI

- Generated from Zod schemas registered in each module (`@asteasolutions/zod-to-openapi`), assembled at startup.
- Served at `/api/docs` (Swagger UI) and `/api/docs/openapi.json`.
- Production: disabled by default (`API_DOCS_ENABLED=false`) or protected behind admin auth.
- CI check: every registered Express route must have an OpenAPI path (a test enumerates the router stack and compares).
