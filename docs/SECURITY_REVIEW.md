# Security review (Phase 12)

Date: 2026-11-21 · Scope: API (`apps/api`), web app (`apps/web`), worker, dependencies.
Method: OWASP Top 10 (2021) walk-through against the code, automated checks added to the test suite, dependency audit. Findings are fixed in the same phase unless marked otherwise.

## Summary

| Area | Result |
|---|---|
| Access control | Default-deny on every route (anonymous → 401), permission matrix on every gated route (each system role lacking the permission → 403, 588 cases), scope checks in services, 404 for resources without a relationship |
| Findings fixed | 3 (see below) |
| Open findings | none high/medium; accepted risks listed at the end |
| Dependencies | `npm audit`: 0 vulnerabilities (production and development) |
| Tests | API 1,051 · shared 48 · web 60 · E2E 54 runs; API line coverage 84.9 % |

## Findings fixed in this review

| # | Severity | Finding | Fix |
|---|---|---|---|
| SR-01 | Low | `GET /students/{id}/records` answered 403 for an existing student the caller may not see and 404 for an unknown id, letting any student enumerate student ids | Answers 404 in both cases, like every other relationship-scoped resource |
| SR-02 | Medium | Messages, discussion posts, tickets, feedback and report exports were only behind the global 300/min/IP limit: one account could flood other users' inboxes and notifications or queue many exports | Per-user limits: messages 30/min, discussion threads and replies 30/min, tickets and feedback 20/hour, exports 30 per 10 min (`userRateLimit`, Redis-backed with an in-memory fallback); test asserts 429 with `Retry-After` |
| SR-03 | Low | Two administrators approving the same grade sheet at once: data stayed correct (one posting), but the losing request failed on a unique constraint (409) instead of the state check | Approval locks the submission row (`SELECT … FOR UPDATE`) so the second request waits and gets the 422 "nothing awaiting approval"; covered by a concurrency test |

## OWASP Top 10 walk-through

**A01 Broken access control.** Every route declares its access (`defineRoute` refuses routes without one); anonymous calls to protected routes are rejected before validation (default-deny test). Route permissions are coarse; services apply scope (`covers`, `scopeFilter`) and relationship checks (section instructors, seat holders, conversation participants, ticket owners). Resources outside the caller's relationship answer 404, so ids cannot be probed (SR-01 closed the remaining gap). Socket.IO emits only to `user:{id}` rooms joined after token verification; events carry ids, and clients re-fetch through authorised endpoints. Signed download links are issued per request after the membership check and expire in 5 minutes.

**A02 Cryptographic failures.** Passwords: Argon2id. Access tokens: short-lived JWT (≤ 1 h, default 15 min) with secret rotation support; secrets must be ≥ 32 characters and production refuses example values. Refresh tokens: rotating, stored hashed, httpOnly + `SameSite=Strict` + `Secure` cookie on a narrow path. Storage URLs are HMAC-signed.

**A03 Injection.** All database access goes through Prisma with parameters; raw SQL uses tagged templates only (`$queryRaw`), the single `$executeRawUnsafe` is the test-database reset. Full-text search uses `websearch_to_tsquery` with a bound parameter. User text is never rendered as HTML (no `dangerouslySetInnerHTML`); links are plain anchors with `rel="noopener noreferrer nofollow"`. CSV exports neutralise formula prefixes (`= + - @ \t \r`). Email templates escape every value.

**A04 Insecure design.** Business rules are enforced server-side (registration rules, edit windows, audience targeting, grade workflow states) and protected by DB constraints (CHECKs, partial unique indexes, triggers). Concurrency-sensitive writes lock rows or use atomic sequences (seats, waitlist promotion, ticket numbers, grade approval, announcement fan-out claim) — all covered by concurrency tests.

**A05 Security misconfiguration.** Helmet on all responses, CORS allow-list from configuration, Swagger UI disabled in production, environment validated at boot (production refuses development secrets), JSON body limit 1 MB, upload sizes enforced per context.

**A06 Vulnerable and outdated components.** `npm audit` reports 0 vulnerabilities. CI runs the audit on every push (Phase 1 workflow).

**A07 Identification and authentication failures.** Login, password reset and token endpoints use fail-closed Redis rate limits (per IP and per IP + identifier); accounts lock with exponential backoff; sessions are revocable individually or all at once; password change revokes other sessions; suspended or deactivated accounts lose access on the next request. MFA is not implemented (accepted risk, below).

**A08 Software and data integrity failures.** Uploads are verified by magic bytes after upload (declared type is not trusted) and rejected files are deleted. Academic records are never deleted; grade changes are versioned. Exports re-run with the requester's current grants in the worker.

**A09 Security logging and monitoring failures.** Audit log for security-relevant and administrative actions (role changes, grade postings and changes, exports, announcement publishing, roster exports …). Pino logs redact credentials and tokens. The administrator dashboard alerts on failed jobs and a stale worker heartbeat.

**A10 Server-side request forgery.** The server never fetches user-supplied URLs; material and announcement links are stored and shown only.

## Accepted risks and follow-ups

| Item | Note |
|---|---|
| No MFA | `mfa_enabled` exists on users; TOTP enrolment is a post-release item (SRS lists MFA as S) |
| Message attachments are not virus-scanned | Types are restricted and verified by content; add ClamAV (or the storage provider's scanner) before opening uploads to external users |
| Load test not executed in this environment | `load/registration.k6.js` is ready (k6 is not installed here); AC-REG-001 covers 50 concurrent requests for one seat in the integration suite |
| CSP | Helmet's default CSP is active for the API; the web app is served by nginx with a strict CSP and security headers (`docker/nginx.conf`) — revisit the CSP when adding third-party scripts |
