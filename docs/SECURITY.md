# Security

> Status: **design (Phase 0)**. Controls are implemented progressively (most in Phases 1–2; reviewed in Phase 12). The checklist at the end tracks implementation.

## 1. Threat model (summary)

| Asset | Threats | Primary controls |
|---|---|---|
| Accounts & sessions | Credential stuffing, brute force, token theft, session fixation | Argon2id, lockout, rate limits, rotating hashed refresh tokens with reuse detection, HttpOnly cookies, short-lived access tokens |
| Academic records & grades | Unauthorized read/modify, insider abuse | Scoped RBAC + relationship policies, separation of duties, append-only audit, versioned grades |
| Registration integrity | Race conditions, bypassing rules via direct API, replay | Server-side rule engine, row locks + DB constraints, idempotency keys |
| Personal data (PII) | Over-exposure, enumeration, leakage via logs | Role-specific DTOs, sensitive data separated (`student_contacts`), log redaction, no PII in URLs |
| Files | Malware, content-type spoofing, path traversal, unauthorized download | Allow-lists, magic-byte sniffing, random keys, signed short-lived URLs, permission check per download, optional AV scan |
| Messaging/announcements | XSS, spam, impersonation | Sanitized markdown subset (server-side `sanitize-html` allow-list), CSP, rate limits, permission-checked audiences |
| Infrastructure | Secret leakage, misconfiguration | Env validation, no secrets in repo, least-privilege DB roles, Helmet, CORS allow-list |

## 2. Authentication

See [ARCHITECTURE.md §6](ARCHITECTURE.md#6-authentication-architecture) and SRS FR-AUTH-*. Key settings:

| Setting | Default |
|---|---|
| Access token TTL | 15 min (`JWT_ACCESS_TTL`) |
| Refresh token TTL | 7 days / 30 days with remember-me |
| Refresh reuse grace | 10 s |
| Lockout | 5 failures → 15 min, exponential up to 24 h |
| Argon2id | m=19456 KiB, t=2, p=1 (tunable; target ~100 ms hash time) |
| Reset/verify tokens | 32 random bytes, SHA-256 hashed at rest, single use |

**Enumeration protection:** login returns `INVALID_CREDENTIALS` for unknown email and wrong password alike, and performs a dummy Argon2 verify for unknown users to equalize timing. Forgot-password always returns 200 with the same body. `ACCOUNT_LOCKED` is only disclosed after the correct password was supplied.

## 3. CSRF

- Bearer-token endpoints are not CSRF-vulnerable (browsers don't attach the header automatically).
- Cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) use: `SameSite=Strict` cookie, path scoping, double-submit token header `X-CSRF-Token`, and an `Origin` header check against the allow-list.

## 4. CORS

Explicit allow-list from `CORS_ORIGINS` (comma-separated). `credentials: true`. No wildcard. Preflight cached 10 min.

## 5. HTTP headers (Helmet + Nginx)

`Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (and CSP `frame-ancestors 'none'`), `Permissions-Policy` minimal. SPA CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <storage-origin>; connect-src 'self' <api-origin> wss://<api-origin> <storage-origin>; object-src 'none'; base-uri 'self'`.

## 6. Input validation and output encoding

- Zod on every request (params, query, body). `.strict()` or stripping of unknown keys. Length limits on all strings. UUID validation on IDs.
- Prisma parameterized queries. Raw SQL only through tagged `$queryRaw` templates (never `$queryRawUnsafe` with user input).
- Sort fields are allow-listed (never interpolated).
- Rich text (announcements, messages, syllabus) is stored as markdown/limited HTML and sanitized server-side on write with an allow-list. The frontend renders through a sanitizing renderer (no `dangerouslySetInnerHTML` without sanitization).
- CSV exports escape cells starting with `=`, `+`, `-`, `@`, tab or CR (CSV-injection protection).

## 7. Authorization

- Default deny: a route without `requirePermission` (or explicit `public`) fails a CI test.
- Scope checks in services; relationship policies for faculty/students; list endpoints filtered with scope `where` fragments.
- 404 for resources outside the caller's visibility (avoid ID probing).
- IDs are UUIDs (non-sequential).
- Privilege escalation guard on role assignment (see USER_ROLES_AND_PERMISSIONS.md §4).

## 8. Rate limiting and abuse

Redis-backed `rate-limiter-flexible` (API.md §10). Auth limiters fail closed if Redis is unavailable (return 503); general limiters fail open with an in-memory fallback.

## 9. Secrets and configuration

- `.env` is git-ignored. `.env.example` lists every variable with safe placeholders.
- Env is validated at startup with Zod (types, required in production, minimum secret lengths). The process refuses to start with default/example secrets when `NODE_ENV=production`.
- JWT signing keys support rotation (`kid`). Secrets come from the orchestrator's secret store in production.

## 10. Database

- Separate DB roles in production: `ucrams_migrator` (DDL), `ucrams_app` (DML, no DDL), with `REVOKE UPDATE, DELETE ON audit_logs FROM ucrams_app`.
- TLS to the DB in production. Backups encrypted at rest.

## 11. Logging

Pino with redaction paths: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.passwordHash`, `*.token`, `*.refreshToken`, `*.secret`. No request bodies logged for auth endpoints. Security events (lockout, token reuse, permission denied bursts) are logged at `warn` with user ID and IP and written to the audit log.

## 12. Files

See SRS FR-FILE-*. Additionally: `Content-Disposition: attachment` for non-image downloads; images re-served with the stored (sniffed) content type; SVG not allowed for user uploads.

## 13. OWASP Top 10 (2021) mapping

| Risk | Controls |
|---|---|
| A01 Broken Access Control | Central guards, scope/relationship policies, default-deny test, 404 on invisible resources, permission test suite per endpoint |
| A02 Cryptographic Failures | TLS, Argon2id, hashed tokens, no sensitive data in JWT, encrypted MFA secrets (AES-256-GCM with key from env) |
| A03 Injection | Zod, Prisma, no unsafe raw SQL, sanitized rich text, CSV-injection escaping |
| A04 Insecure Design | Threat model, registration engine designed for concurrency, business rules server-side, SRS edge cases |
| A05 Security Misconfiguration | Helmet, CORS allow-list, env validation, docs disabled in prod, minimal container images, non-root containers |
| A06 Vulnerable Components | `npm audit` in CI, Dependabot/Renovate, pinned lockfile |
| A07 Identification & Auth Failures | Lockout, rate limits, rotation + reuse detection, session revocation, MFA-ready |
| A08 Software & Data Integrity | Lockfile, CI-built images, signed migrations in repo, no dynamic code loading |
| A09 Logging & Monitoring Failures | Structured logs, audit log, security events, failed-job alerts |
| A10 SSRF | No user-supplied URL fetching; course material external links are stored and rendered only, never fetched server-side |

## 14. Implementation checklist

| Control | Phase | Status |
|---|---|---|
| Env validation, .env.example | 1 | Done (production refuses example secrets and enabled docs) |
| Helmet, CORS, request IDs, error sanitization | 1 | Done (tested) |
| Pino redaction | 1 | Done |
| Argon2id, login, lockout, login history | 2 | Done (tested) |
| Refresh rotation + reuse detection | 2 | Done (tested, incl. concurrent refresh grace) |
| CSRF double-submit for cookie endpoints | 2 | Done (+ Origin check) |
| Rate limiting (Redis) | 1–2 | Done: global (fail-open with insurance) and auth (fail-closed, hashed identifiers) |
| RBAC guards + scope policies + default-deny test | 2 | Done (incl. OWN-scoped relationship grants, escalation guard) |
| Audit log | 2 | Done (transactional writes, filtered read API) |
| MFA (TOTP) | — | Planned (Should); model field present |
| File validation + signed URLs | 7 | Planned |
| Rich-text sanitization | 9 | Planned |
| CSV-injection escaping | 11 | Planned |
| Full OWASP review + fixes | 12 | Planned |
