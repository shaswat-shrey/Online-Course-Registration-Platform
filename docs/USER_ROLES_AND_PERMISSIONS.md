# User Roles and Permissions

> Status: **implemented** and enforced by a route-level permission matrix test. Permission keys live in `packages/shared/src/permissions.ts`, the role matrix in `packages/shared/src/roles.ts`; both are synced into the database by the seed and by `npm run bootstrap:admin`.

## 1. Model

- **Permission**: `resource:action` string. Granular and stable; never renamed (deprecate and add instead).
- **Role**: named set of permissions. System roles (`is_system = true`) can be edited only by Super Admins and cannot be deleted. Custom roles can be created.
- **Role assignment**: `(user, role, scope)`. Scope is one of:
  - `GLOBAL`: whole university.
  - `SCHOOL:<id>`: the school and every department in it.
  - `DEPARTMENT:<id>`: that department only.
- **Effective grant** = union of all the user's assignments. A permission held at `SCHOOL:X` covers resources whose department belongs to school X.
- **Scope mode (ADR-014).** Each role is ORGANIZATIONAL or RELATIONSHIP. Faculty Member and Student are RELATIONSHIP roles: they are assigned without a school/department, and their permissions become `OWN` grants. An `OWN` grant never covers any organisational target; it only works together with a relationship check (teaches this section, owns this record). This stops a lecturer's `material:manage` from meaning "every section in the university".
- **Relationship policies** add a second check for faculty and students (teaches this section / owns this record). Holding `roster:read` alone is not enough; the faculty member must also teach the section.

### Scope resolution for resources

| Resource | Department resolved via |
|---|---|
| Department | itself |
| Program | `program.department_id` |
| Specialization | `specialization.program.department_id` |
| Course | `course.department_id` |
| Section | `section.course.department_id` |
| Student | `student.program.department_id` |
| Faculty member | `faculty_member.department_id` (+ secondary departments) |
| Registration | via section **or** via student (either grants access, e.g. a dept admin sees registrations into their courses and registrations by their students) |
| School-level resources | school ID; DEPARTMENT-scoped grants do not cover them |
| University, roles, settings, calendar | GLOBAL only |

## 2. Roles

| Role key | Name | Typical scope | Description |
|---|---|---|---|
| `SUPER_ADMIN` | Super Administrator | GLOBAL | Everything, including RBAC and system settings. Should be 1–3 people. |
| `UNIVERSITY_ADMIN` | University Administrator | GLOBAL | Runs the university: structure, users, calendar, reports. Cannot change RBAC definitions or security settings. |
| `ACADEMIC_ADMIN` | Academic Administrator | GLOBAL or SCHOOL | Registrar: catalog, sections, registrations, records, grades, students. |
| `DEPARTMENT_ADMIN` | Department Administrator | DEPARTMENT | Academic admin limited to their department(s). |
| `FACULTY` | Faculty Member | GLOBAL (relationship-bound) | Teaching and communication for their own sections. |
| `STUDENT` | Student | GLOBAL (ownership-bound) | Self-service for their own records. |

The Head of Department is a *field* on the department, not a role. To give a HOD admin rights, also assign `DEPARTMENT_ADMIN` scoped to that department.

## 3. Permission catalogue

| Permission | Description |
|---|---|
| **System** | |
| `settings:read` | View system settings |
| `settings:manage` | Change system settings |
| `rbac:read` | View roles and permissions |
| `rbac:manage` | Create/edit roles and role-permission mappings |
| `audit:read` | View audit logs |
| `jobs:read` | View background job status / failures |
| `jobs:manage` | Retry/remove failed jobs |
| **Users** | |
| `user:read` | View user accounts |
| `user:create` | Create accounts / send invitations |
| `user:update` | Edit account details |
| `user:manage_status` | Suspend, deactivate, reactivate, unlock |
| `user:assign_roles` | Assign/revoke roles (only roles whose permissions ⊆ the assigner's, within the assigner's scope) |
| `user:read_sessions` | View others' sessions / login history |
| `user:revoke_sessions` | Revoke others' sessions |
| `student:read` | View student academic profiles |
| `student:read_sensitive` | View address, emergency contact, DOB, hold reasons |
| `student:create` | Create student records |
| `student:update` | Edit student records, program/specialization assignment |
| `student:import` | Bulk import students |
| `student:manage_holds` | Place/release registration holds |
| `faculty:read` | View faculty profiles (directory info is public to authenticated users; this covers workload and admin fields) |
| `faculty:create` / `faculty:update` / `faculty:import` | Manage faculty records |
| `admin:manage` | Manage administrator profiles |
| **Structure** | |
| `university:manage` | Edit university profile and campuses |
| `school:manage` | CRUD schools |
| `department:manage` | CRUD departments |
| `degree:manage` | CRUD degrees |
| `program:manage` | CRUD programs and requirements |
| `specialization:manage` | CRUD specializations and requirements |
| `classroom:manage` | CRUD classrooms |
| **Calendar** | |
| `session:manage` | CRUD academic years and sessions |
| `registration_period:manage` | Configure registration periods, priority windows, policies |
| `grading_scale:manage` | Configure grading scales |
| **Catalog** | |
| `course:create` / `course:update` / `course:archive` | Manage courses, prerequisites, mappings, restrictions |
| `section:create` / `section:update` / `section:publish` / `section:cancel` | Manage sections |
| `section:publish_without_instructor` | Publish sections with no primary instructor |
| `section:assign_faculty` | Assign/unassign instructors and course coordinators |
| `section:override_conflicts` | Save classroom/instructor conflicts |
| **Registration** | |
| `registration:read` | View registrations within scope |
| `registration:approve` | Approve/reject pending registrations and requests |
| `registration:manage` | Register/drop/withdraw on behalf of students |
| `registration:override` | Bypass specific rules (capacity, prereq, conflict, credit, period) |
| `waitlist:manage` | Remove/promote/reorder waitlist entries |
| `registration:self` | Register/drop/withdraw for oneself (students) |
| **Academics** | |
| `roster:read` | Read rosters (relationship-bound for faculty) |
| `roster:export` | Export rosters |
| `material:manage` | Manage course materials (relationship-bound for faculty) |
| `attendance:manage` | Record attendance (relationship-bound for faculty) |
| `assessment:manage` | Manage assessments and scores (relationship-bound for faculty) |
| `grade:submit` | Submit final grades (primary instructor) |
| `grade:approve` | Approve and post grades |
| `grade:change` | Change posted grades (with reason) |
| `record:read` | View academic records of students in scope |
| `record:manage` | Add transfer credits/exemptions, correct records |
| **Communication** | |
| `message:send` | Use messaging (subject to conversation rules) |
| `message:moderate` | Moderate section conversations and discussions within scope |
| `announcement:publish_section` | Announce to own sections (faculty) |
| `announcement:publish_scoped` | Announce to departments/programs/courses within scope |
| `announcement:publish_global` | Announce to all students/faculty/admins |
| `feedback:submit` | Submit feedback |
| `feedback:manage` | Triage, respond to, resolve feedback |
| `ticket:submit` | Create support tickets |
| `ticket:manage` | Assign, respond, resolve tickets; see internal notes |
| **Reports** | |
| `dashboard:admin` | Access the admin dashboard (scoped) |
| `report:read` | View reports within scope |
| `report:export` | Export reports |
| **Files** | |
| `document:manage` | Manage administrative documents |

## 4. Role → permission matrix

Legend: ✅ granted · 🔹 granted, limited to assigned scope (school/department) · 👤 granted, limited by relationship/ownership · — not granted

| Permission | SUPER_ADMIN | UNIVERSITY_ADMIN | ACADEMIC_ADMIN | DEPARTMENT_ADMIN | FACULTY | STUDENT |
|---|---|---|---|---|---|---|
| settings:read | ✅ | ✅ | — | — | — | — |
| settings:manage | ✅ | — | — | — | — | — |
| rbac:read | ✅ | ✅ | — | — | — | — |
| rbac:manage | ✅ | — | — | — | — | — |
| audit:read | ✅ | ✅ | 🔹 | — | — | — |
| jobs:read / jobs:manage | ✅ | ✅ / — | — | — | — | — |
| user:read | ✅ | ✅ | 🔹 | 🔹 | — | — |
| user:create / user:update | ✅ | ✅ | 🔹 | 🔹 | — | — |
| user:manage_status | ✅ | ✅ | 🔹 | — | — | — |
| user:assign_roles | ✅ | ✅ (not SUPER_ADMIN) | 🔹 (FACULTY, STUDENT, DEPARTMENT_ADMIN in scope) | — | — | — |
| user:read_sessions / revoke_sessions | ✅ | ✅ | — | — | — | — |
| student:read | ✅ | ✅ | 🔹 | 🔹 | 👤 (own sections, limited fields) | 👤 (self) |
| student:read_sensitive | ✅ | ✅ | 🔹 | — | — | 👤 (self) |
| student:create / update / import | ✅ | ✅ | 🔹 | 🔹 (create/update only) | — | — |
| student:manage_holds | ✅ | ✅ | 🔹 | 🔹 | — | — |
| faculty:read | ✅ | ✅ | 🔹 | 🔹 | — | — |
| faculty:create / update / import | ✅ | ✅ | 🔹 | 🔹 (update only) | — | — |
| admin:manage | ✅ | ✅ | — | — | — | — |
| university:manage | ✅ | ✅ | — | — | — | — |
| school:manage | ✅ | ✅ | — | — | — | — |
| department:manage | ✅ | ✅ | 🔹 | 🔹 (edit own, no create) | — | — |
| degree:manage | ✅ | ✅ | ✅ | — | — | — |
| program:manage / specialization:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |
| classroom:manage | ✅ | ✅ | ✅ | — | — | — |
| session:manage | ✅ | ✅ | ✅ | — | — | — |
| registration_period:manage | ✅ | ✅ | ✅ | — | — | — |
| grading_scale:manage | ✅ | ✅ | ✅ | — | — | — |
| course:create / update / archive | ✅ | ✅ | 🔹 | 🔹 | — | — |
| section:create / update / publish / cancel | ✅ | ✅ | 🔹 | 🔹 | — | — |
| section:publish_without_instructor | ✅ | ✅ | 🔹 | — | — | — |
| section:assign_faculty | ✅ | ✅ | 🔹 | 🔹 | — | — |
| section:override_conflicts | ✅ | ✅ | 🔹 | — | — | — |
| registration:read | ✅ | ✅ | 🔹 | 🔹 | 👤 (own sections) | 👤 (self) |
| registration:approve | ✅ | ✅ | 🔹 | 🔹 | — | — |
| registration:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |
| registration:override | ✅ | ✅ | 🔹 | — | — | — |
| waitlist:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |
| registration:self | — | — | — | — | — | 👤 |
| roster:read | ✅ | ✅ | 🔹 | 🔹 | 👤 | — |
| roster:export | ✅ | ✅ | 🔹 | 🔹 | 👤 | — |
| material:manage | ✅ | ✅ | 🔹 | 🔹 | 👤 | — |
| attendance:manage | ✅ | ✅ | 🔹 | 🔹 | 👤 | — |
| assessment:manage | ✅ | — | — | — | 👤 | — |
| grade:submit | — | — | — | — | 👤 (primary instructor) | — |
| grade:approve | ✅ | ✅ | 🔹 | 🔹 | — | — |
| grade:change | ✅ | — | 🔹 | — | — | — |
| record:read | ✅ | ✅ | 🔹 | 🔹 | 👤 (own section students, limited) | 👤 (self) |
| record:manage | ✅ | — | 🔹 | — | — | — |
| message:send | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| message:moderate | ✅ | ✅ | 🔹 | 🔹 | 👤 (own sections) | — |
| announcement:publish_section | ✅ | ✅ | 🔹 | 🔹 | 👤 | — |
| announcement:publish_scoped | ✅ | ✅ | 🔹 | 🔹 | — | — |
| announcement:publish_global | ✅ | ✅ | ✅ (when GLOBAL scope) | — | — | — |
| feedback:submit | — | — | — | — | ✅ | ✅ |
| feedback:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |
| ticket:submit | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ticket:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |
| dashboard:admin | ✅ | ✅ | 🔹 | 🔹 | — | — |
| report:read / report:export | ✅ | ✅ | 🔹 | 🔹 | — | — |
| document:manage | ✅ | ✅ | 🔹 | 🔹 | — | — |

Notes:
- A permission marked 🔹 is still *granted* to the role; the scope comes from the role assignment. Assigning `ACADEMIC_ADMIN` at GLOBAL scope makes every 🔹 effectively ✅.
- `UNIVERSITY_ADMIN` intentionally lacks `grade:submit`, `grade:change`, `record:manage` and `assessment:manage` (separation of duties: grades and academic records belong to faculty and the registrar). It holds every Department Administrator permission so it can provision department admins; it cannot create Academic Administrators (only the Super Administrator can).
- Privilege-escalation guard: assigning or revoking any role requires `user:assign_roles` covering the target scope. For ORGANIZATIONAL roles, the assigner must also hold every one of the role's permissions at that scope. RELATIONSHIP roles confer no organisational power, so the subset check does not apply (otherwise a university admin, who deliberately lacks `grade:submit`, could not assign the Faculty role).
- Role administration (`rbac:*`) and audit reading require a university-wide grant.
- The Super Administrator role's permissions cannot be edited, and the last Super Administrator assignment cannot be removed.

## 5. Messaging permissions

| From \ To | Student | Faculty | Admin |
|---|---|---|---|
| **Student** | — (no student-to-student DMs initially; section discussion only) | ✅ if registered in a current section they teach (setting `messaging.studentToAnyFaculty` relaxes this) | Via the **Support inbox** conversation (shared by admins with `ticket:manage`) |
| **Faculty** | ✅ students in their sections (current or last session) | ✅ | ✅ |
| **Admin** | ✅ within scope | ✅ | ✅ |

Section conversations: members are instructors plus students with seat-holding registrations; membership updates on registration change. If `announcement_only`, only moderators can post.

## 6. Announcement targeting permissions

| Audience type | Required permission |
|---|---|
| SECTION, COURSE (own sections only) | `announcement:publish_section` + teaches the section/course in the current session |
| SECTION, COURSE, PROGRAM, SPECIALIZATION, DEPARTMENT, YEAR_OF_STUDY within scope | `announcement:publish_scoped` (scope-checked) |
| SCHOOL | `announcement:publish_scoped` at SCHOOL or GLOBAL scope |
| ALL_STUDENTS, ALL_FACULTY, ALL_ADMINS, ALL_USERS | `announcement:publish_global` |
| USER (specific users) | `announcement:publish_scoped` and each user in scope, or faculty for their own students |

## 7. Frontend route → permission map

| Route prefix | Requirement |
|---|---|
| `/admin/*` | any of `dashboard:admin` (plus per-page permission, e.g. `/admin/courses` → `course:update` or `report:read`) |
| `/faculty/*` | has a `FacultyMember` profile and the `FACULTY` role |
| `/student/*` | has a `Student` profile and the `STUDENT` role |
| `/profile/security` | authenticated |

Users with several portals (e.g. faculty who is also department admin) get a portal switcher in the header.

## 8. Development accounts (Phase 2 seed)

| Role | Email | Scope |
|---|---|---|
| Super Admin | `superadmin@ucrams.local` | GLOBAL |
| University Admin | `uniadmin@ucrams.local` | GLOBAL |
| Academic Admin | `registrar@ucrams.local` | GLOBAL |
| Department Admin | `cs.admin@ucrams.local` | DEPARTMENT: Computer Science |
| Faculty | `faculty.cs@ucrams.local` | — |
| Student | `student.cs@ucrams.local` | — |

Faculty and Student accounts are RELATIONSHIP-scoped (no school/department). The development password is set from `SEED_DEV_PASSWORD` in `apps/api/.env` (example value in `.env.example`) and documented in the README. The seed refuses to run in production.
