# API Design

> Status: **implemented**. Endpoints marked ✅ exist; the live OpenAPI document at `/api/docs` (development) is authoritative for request and response shapes. Every group listed in §7 is implemented.

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
| `MFA_INVALID` | 401 | Wrong or already-used two-factor code |
| `MFA_CHALLENGE_EXPIRED` | 401 | Sign-in challenge expired or used up; sign in again |
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
| `AUDIENCE_NOT_ALLOWED` | 403 | Announcement audience outside the author's scope (FR-COMM-011) |
| `EDIT_WINDOW_PASSED` | 422 | Messages are editable for 15 minutes |
| `THREAD_LOCKED` | 422 | |
| `RATE_LIMITED` | 429 | |
| `INTERNAL_ERROR` | 500 | |

## 7. Endpoint groups

The table lists the main endpoints per group. Standard CRUD = `GET /x` (list), `POST /x`, `GET /x/{id}`, `PATCH /x/{id}`, `DELETE /x/{id}` (only where deletion is allowed; otherwise `POST /x/{id}/deactivate` / `activate`).

| Group | Endpoints |
|---|---|
| **Health** | `GET /health/live`, `GET /health/ready` (implemented, Phase 1) |
| **Auth** (implemented, except verify-email) | `POST /auth/login` (returns `{ mfaRequired, challengeToken, expiresAt }` instead of a session when two-factor sign-in is on), `POST /auth/mfa/verify` (`challengeToken`, `code`: a TOTP or a recovery code; 5 attempts per challenge, 5-minute expiry), `GET /auth/mfa`, `POST /auth/mfa/setup`, `POST /auth/mfa/enable`, `POST /auth/mfa/disable` (password + code), `POST /auth/mfa/recovery-codes`, `POST /users/{id}/mfa/reset` (`user:manage_status`), `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/accept-invite`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `GET /auth/login-history` |
| **Users** (implemented in Phase 2: `GET/POST /users/{id}/roles`, `DELETE /users/{id}/roles/{assignmentId}`, `GET/DELETE /users/{id}/sessions`, `GET /users/{id}/login-history`, `POST /users/{id}/unlock`) | CRUD `/users`, `POST /users/{id}/suspend|reactivate|deactivate|unlock`, `GET/POST/DELETE /users/{id}/roles`, `GET /users/{id}/sessions`, `DELETE /users/{id}/sessions`, `POST /users/{id}/resend-invite` |
| **RBAC** (implemented, Phase 2) | `GET /roles`, `POST /roles`, `PATCH /roles/{id}`, `DELETE /roles/{id}`, `PUT /roles/{id}/permissions`, `GET /permissions` |
| **Students** | ✅ `GET/POST /students`, `GET/PATCH /students/{id}`, `GET/PATCH /students/me`, `POST /students/{id}/change-program`, `POST /students/{id}/status`, `POST /students/{id}/holds`, `POST /students/{id}/holds/{holdId}/release`. Records: `GET /students/{id}/records`, `GET /students/{id}/transcript`; registrations through `GET /registrations?studentId=` |
| **Faculty** | ✅ `GET/POST /faculty`, `GET/PATCH /faculty/{id}`, `GET/PATCH /faculty/me`, `GET /faculty/directory`, `GET /faculty/{id}/schedule?sessionId=`, `GET /faculty/me/dashboard`, `GET /faculty/me/sections?scope=current|upcoming|past` |
| **Administrators** | ✅ `GET/POST /administrators`, `GET/PATCH /administrators/{id}`; account actions `POST /users/{id}/status` (suspend/reactivate/deactivate), `POST /users/{id}/resend-invite` |
| **Imports** | ✅ `GET /imports/templates/{students\|faculty}` (CSV), `POST /imports/{kind}/preview` (multipart CSV/XLSX → preview job), `GET /imports`, `GET /imports/{id}`, `GET /imports/{id}/rows?status=`, `POST /imports/{id}/commit` (`{ sendInvites }`, queued), `POST /imports/{id}/cancel` |
| **University** (implemented, Phase 3) | `GET /university/public`, `GET/PATCH /university`, `GET/POST /campuses`, `PATCH/DELETE /campuses/{id}` |
| **Schools** (implemented, Phase 3) | `GET/POST /schools` (search `q`, `status`, sort, pagination), `GET/PATCH/DELETE /schools/{id}` (detail includes counts) |
| **Departments** (implemented, Phase 3) | `GET/POST /departments` (`q`, `status`, `schoolId`), `GET/PATCH/DELETE /departments/{id}`; responses carry `canManage` |
| **Degrees** (implemented, Phase 3) | `GET/POST /degrees` (`level`, `status`), `PATCH/DELETE /degrees/{id}` |
| **Programs** (implemented, Phase 3) | `GET/POST /programs` (`q`, `status`, `departmentId`, `schoolId`, `degreeId`, `level`), `GET/PATCH/DELETE /programs/{id}` (detail includes specializations and requirement groups), `POST /programs/{id}/requirement-groups`, `PUT/DELETE /requirement-groups/{id}` |
| **Specializations** (implemented, Phase 3) | `GET /programs/{id}/specializations`, `POST /specializations`, `PATCH/DELETE /specializations/{id}`, `POST /specializations/{id}/requirement-groups` |
| **Academic calendar** (implemented, Phase 3) | `GET/POST /academic-years`, `PATCH/DELETE /academic-years/{id}`, `GET/POST /academic-sessions` (`academicYearId`, `status`, `current`), `GET/PATCH/DELETE /academic-sessions/{id}`, `POST /academic-sessions/{id}/transition` (`activate`, `complete`, `archive`, `make-current`), `PUT /academic-sessions/{id}/policy`, `PUT /academic-sessions/{id}/registration-period`, `POST/DELETE /academic-sessions/{id}/priority-windows[/{windowId}]`; session responses include policy, period and computed `registrationState` |
| **Grading scales** (implemented, Phase 3) | `GET/POST /grading-scales`, `GET/PUT/DELETE /grading-scales/{id}` (bands locked once a completed session uses the scale) |
| **Classrooms** | ✅ `GET/POST /classrooms` (`q`, `campusId`, `type`, `status`, `minCapacity`), `GET/PATCH/DELETE /classrooms/{id}`, `GET /classrooms/{id}/schedule?sessionId=` |
| **Courses** | ✅ `GET/POST /courses` (`q` ranked full-text, `departmentId`, `schoolId`, `category`, `level`, `programId`, `specializationId`, `minCredits`, `maxCredits`, `status`), `GET/PATCH/DELETE /courses/{id}` (status changes via PATCH), `PUT /courses/{id}/prerequisites`, `PUT /courses/{id}/corequisites`, `PUT /courses/{id}/programs`, `PUT /courses/{id}/specializations`, `PUT /courses/{id}/restrictions`, `PUT /requirement-groups/{id}/courses`. Student catalog: `GET /catalog/sessions`, `GET /catalog?sessionId=` (filters incl. `availability=open|waitlist`, `mine=true`), `GET /catalog/courses/{id}?sessionId=` |
| **Course sections** | ✅ `GET/POST /course-sections` (`sessionId`, `courseId`, `departmentId`, `schoolId`, `status`, `facultyMemberId`, `hasSeats`, `unassigned`, `q`), `GET/PATCH/DELETE /course-sections/{id}`, `PUT /course-sections/{id}/meetings`, `PUT /course-sections/{id}/instructors` (both accept `override: { reason }`; conflicts return 409 `CLASSROOM_CONFLICT`/`INSTRUCTOR_CONFLICT` with `details.conflicts`), `PUT /course-sections/{id}/restrictions`, `POST /course-sections/{id}/transition` (`publish`, `close`, `reopen`, `cancel` + reason, `complete`), `POST /course-sections/roll-forward`, `GET /faculty/{id}/schedule?sessionId=`. `GET /course-sections/{id}/workspace`, `GET /course-sections/{id}/roster` (`q`, `status`), `GET /course-sections/{id}/roster/export` (CSV), `GET /course-sections/{id}/students/{studentId}` (academic profile), `GET/POST /course-sections/{id}/materials`, `GET /course-sections/{id}/announcements` |
| **Registrations** | ✅ `GET /registrations/eligibility?sectionId=&studentId=`, `POST /registrations` (`{ sectionId, joinWaitlist }`, `Idempotency-Key`), `POST /registrations/batch`, `GET /registrations/me?sessionId=`, `GET /registrations` (scoped; filters `sessionId`, `status`, `departmentId`, `courseId`, `sectionId`, `studentId`, `from`, `to`, `hasOverrides`, `q`), `GET /registrations/{id}` (with history), `POST /registrations/{id}/drop` (also leaves a waitlist, cancels a pending request or declines an offer; `alsoDrop` for corequisite pairs), `POST /registrations/{id}/withdraw`, `POST /registrations/{id}/claim`, `POST /registrations/{id}/decision`, `POST /registrations/bulk-decision`, `GET /registration-requests`, `POST /registration-requests/{id}/decision`, `POST /admin/registrations` (on behalf, `overrides[]` + `reason`) |
| **Waitlist** | ✅ joining is `POST /registrations` with `joinWaitlist: true`; leaving is `/registrations/{id}/drop`; `POST /registrations/{id}/claim` (offers); `GET /course-sections/{id}/registrations` (seat holders + ordered waitlist), `POST /course-sections/{id}/waitlist/promote` |
| **Planner** | ✅ `GET/POST /course-plans`, `GET/DELETE /course-plans/{id}`, `PUT /course-plans/{id}/items`, `GET /course-plans/{id}/validate`, `POST /course-plans/{id}/register` |
| **Timetables** | ✅ `GET /students/me/timetable?sessionId=`, `GET /students/me/timetable.ics?sessionId=`, `GET /classrooms/{id}/schedule`, `GET /classrooms/availability?sessionId=&minCapacity=` (free/busy), `GET /faculty/{id}/schedule`; section schedules are part of `GET /course-sections/{id}` |
| **Attendance** | ✅ `GET /course-sections/{id}/attendance` (register with percentages), `PUT /course-sections/{id}/attendance/settings` (`enabled`), `POST /course-sections/{id}/attendance-sessions`, `PUT /attendance-sessions/{id}/records`, `DELETE /attendance-sessions/{id}`, `GET /course-sections/{id}/my-attendance`; roster rows carry `attendancePercent` |
| **Assessments** | ✅ `GET /course-sections/{id}/gradebook`, `POST /course-sections/{id}/assessments` (weights ≤ 100 %), `PATCH /assessments/{id}` (incl. `published`, which notifies students), `DELETE /assessments/{id}`, `PUT /assessments/{id}/scores`, `GET /course-sections/{id}/my-assessments` |
| **Grades** | ✅ `GET/PUT /course-sections/{id}/final-grades` (sheet with computed marks and suggested letters; drafts by the primary instructor), `POST /course-sections/{id}/final-grades/submit|approve|return`, `GET /grade-submissions?status=`, `POST /academic-records/{id}/grade-change` (`grade:change`, reason), `GET /academic-records/{id}/grade-history` |
| **Academic records** | ✅ `GET /students/me/progress`, `GET /students/me/history` (session GPA, CGPA), `GET /students/me/announcements`, `GET /academic-records/me`, `GET /students/{id}/records` (with CGPA), `GET /students/me/transcript`, `GET /students/{id}/transcript` (GPA per the university repeat policy). `POST /students/{id}/records` (`record:manage`): transfer credit (`source=TRANSFER`, institution required) or exemption; never counted in the GPA; rejected when the course is already passed; the student is notified |
| **Announcements** | ✅ `POST /announcements` (faculty `sectionIds[]` or `audiences[]` of `ALL_USERS/ALL_STUDENTS/ALL_FACULTY/ALL_ADMINS/USER/SCHOOL/DEPARTMENT/PROGRAM/SPECIALIZATION/COURSE/SECTION/YEAR_OF_STUDY` with `roleFilter`; `publishAt` schedules, `expiresAt`), `GET /announcements/feed?unread=`, `GET /announcements/manage`, `GET /announcements/mine`, `GET/PATCH/DELETE /announcements/{id}` (changing `publishAt` reschedules), `POST /announcements/{id}/read`, `GET /course-sections/{id}/announcements` |
| **Messaging** | ✅ `GET /conversations?box=mine|support`, `GET /conversations/unread-count`, `GET /conversations/contacts?q=` (who the user may message), `GET /conversations/search?q=`, `POST /conversations/direct`, `POST /conversations/support`, `GET/PATCH /conversations/{id}` (`muted`, `announcementOnly`), `POST /conversations/{id}/read`, `GET /conversations/{id}/messages?before=&limit=`, `POST /conversations/{id}/messages` (`body`, `fileIds[]`), `PATCH/DELETE /messages/{id}`, `GET /messages/{id}/attachments/{fileId}`. Socket.IO events to `user:{id}`: `message:new`, `message:updated`, `message:deleted`, `conversation:read`, `notification:new` |
| **Discussions** | ✅ `GET /discussions/boards`, `GET/POST /course-sections/{id}/discussions` (`q`, `type`, `unanswered`), `GET/PATCH/DELETE /discussions/{id}` (moderators: `pinned`, `locked`, `answerPostId`), `POST /discussions/{id}/posts`, `DELETE /discussion-posts/{id}` |
| **Notifications** | ✅ `GET /notifications?unread=` (paged), `GET /notifications/unread-count`, `POST /notifications/read` (ids or all), `GET/PUT /notifications/preferences` (mandatory channels cannot be switched off), `GET/PUT /notifications/digest` (`enabled`: one hourly summary email instead of an email per notification; mandatory emails are still sent immediately) |
| **Feedback** | ✅ `POST /feedback`, `GET /feedback/mine`, `GET /feedback` (scoped queue; `status`, `category`, `assignedToMe`), `GET /feedback/assignees?departmentId=`, `GET/PATCH /feedback/{id}` (status, priority, assignee, resolution note), `POST /feedback/{id}/responses` |
| **Support tickets** | ✅ `POST /tickets` (`fileIds[]`), `GET /tickets/mine`, `GET /tickets` (scoped queue; `status=ACTIVE|…`, `category`, `assignedToMe`, `q`), `GET /tickets/assignees`, `GET/PATCH /tickets/{id}` (status, priority, assignee; detail includes responses and status history), `POST /tickets/{id}/responses` (`internal`, `status`, `fileIds[]`), `POST /tickets/{id}/reopen`, `GET /tickets/{id}/attachments/{fileId}` |
| **Files / documents** | ✅ `POST /files/upload-intents` (contexts `AVATAR`, `MATERIAL`, `MESSAGE`, `TICKET`, `DOCUMENT` — the last needs `document:manage`), `POST /files/{id}/complete`, `PUT/DELETE /me/avatar`, `PATCH/DELETE /materials/{id}`, `GET /materials/{id}/download` (signed link after the membership check); ✅ `GET /documents?q=&category=&manage=true` (published to the caller by audience and department, or those the caller manages), `POST /documents` (`document:manage` covering the department; university-wide needs a global grant), `GET /documents/{id}/download`, `DELETE /documents/{id}` |
| **Search** | ✅ `GET /search?q=&types=course,department,program,specialization,faculty,student&limit=` (grouped; students only for holders of department/school/global `student:read`, within scope; 60 requests per minute per user) |
| **Dashboards** | ✅ `GET /faculty/me/dashboard`, `GET /students/me/dashboard`, `GET /dashboards/admin` (filters `academicYearId`, `sessionId`, `schoolId`, `departmentId`, `degreeId`, `programId`, `specializationId`, `courseId`; scoped; cached 60 s, invalidated by registration events) |
| **Reports** | ✅ `GET /reports` (catalogue of 15), `GET /reports/{key}?page&limit&sort=field:dir&sessionId&schoolId&departmentId&programId&courseId&status&q` (scoped), `POST /reports/{key}/export` (`{ format: CSV|XLSX, filters, sort }`; ≤ 5,000 rows inline, else queued on `exports` with a notification; audited), `GET /reports/exports`, `GET /reports/exports/{id}/download` |
| **Settings** | ✅ `GET /settings`, `PATCH /settings/{key}` (`settings:manage`; values validated against the registry in `packages/shared/src/platform.ts`; audited), `GET /settings/public` (any signed-in user: the portal banner) |
| **Audit logs** | `GET /audit-logs` (implemented, Phase 2; filters `action` prefix, `entityType`, `entityId`, `actorId`, `from`, `to`), `GET /audit-logs/{id}`, `POST /audit-logs/export` |
| **Jobs** | ✅ `GET /jobs` (`jobs:read`: counts per queue, worker heartbeat, last 100 failures), `POST /jobs/{queue}/{id}/retry`, `DELETE /jobs/{queue}/{id}` (`jobs:manage`; audited) |

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
