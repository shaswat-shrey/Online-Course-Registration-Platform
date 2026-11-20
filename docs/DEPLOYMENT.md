# Deployment and operations guide

How to run UCRAMS in production, upgrade it, back it up and watch it. For local development see the [README](../README.md).

## 1. What runs

| Process | Command (compiled) | Scales | Notes |
|---|---|---|---|
| API | `node apps/api/dist/server.js` | horizontally (stateless) | REST under `/api/v1`, Socket.IO under `/socket.io` (WebSocket only, Redis adapter) |
| Worker | `node apps/api/dist/worker.js` | 1+ (queues are shared) | Email, imports, exports, waitlist, announcements, maintenance schedulers |
| Web | static files from `apps/web/dist` behind Nginx | CDN/static | Nginx also proxies `/api` and `/socket.io` to the API (`docker/nginx.conf`) |
| PostgreSQL 16+ | — | primary + replicas/backups | System of record |
| Redis 7+ | `--appendonly yes --maxmemory-policy noeviction` | single instance or managed | Queues, rate limits, caches, socket fan-out. **Never** allow eviction: queued jobs would be lost |
| Object storage | S3-compatible (S3, R2, MinIO) | managed | Uploads and exports; private bucket, presigned URLs only |
| SMTP | any provider | — | Email delivery (`MAIL_TRANSPORT=smtp`) |

## 2. Configuration

All variables are listed in `apps/api/.env.example` and validated at start-up; the process exits on any invalid value. With `NODE_ENV=production` the API additionally **refuses example secrets** and requires `API_DOCS_ENABLED=false`.

Required in production:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL URL (use TLS: `?sslmode=require` with managed databases) |
| `REDIS_URL` | Redis URL (`rediss://` for TLS) |
| `JWT_ACCESS_SECRET` | ≥ 32 random characters — `openssl rand -base64 48` |
| `STORAGE_SIGNING_SECRET` | ≥ 32 random characters |
| `MFA_ENCRYPTION_KEY` | ≥ 32 random characters; encrypts two-factor secrets. **Changing it disables every user's two-factor sign-in** (they must enrol again) |
| `STORAGE_DRIVER` | `s3` with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` |
| `PUBLIC_API_URL`, `WEB_APP_URL` | Public origin, e.g. `https://register.university.edu` |
| `CORS_ORIGINS` | The web origin(s), comma-separated |
| `TRUST_PROXY` | Number of proxy hops in front of the API (1 behind Nginx) |
| `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM` | `smtp` and the provider's settings |

Rotate the JWT secret without signing everyone out: set the new value in `JWT_ACCESS_SECRET` and the old one in `JWT_ACCESS_SECRET_PREVIOUS` for one access-token lifetime (15 min by default), then remove it.

## 3. First deployment

### With Docker Compose (single host)

```bash
cp .env.docker.example .env        # set every secret to a strong value
docker compose --profile app up -d --build
```

Compose builds the images (the API image once, shared by `migrate`, `api` and `worker`), runs `prisma migrate deploy` once, then starts the API, worker and web (Nginx on port 8080). Files are stored on the `storage` volume with the local driver; for several hosts use S3/R2 (`STORAGE_DRIVER=s3` and the `S3_*` variables in an override file). Put TLS in front (a load balancer or another Nginx/Caddy) and point your domain at it.

Create the first Super Administrator (prints a one-time activation link and emails it; does nothing if one exists):

```bash
docker compose --profile app run --rm \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@university.edu \
  -e BOOTSTRAP_ADMIN_FIRST_NAME=Ada -e BOOTSTRAP_ADMIN_LAST_NAME=Admin \
  api node apps/api/dist/bootstrap-admin.js
```

### Without Docker

```bash
npm ci
npm run build                                   # shared, api (incl. prisma generate), web
npm run db:deploy                               # prisma migrate deploy
BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_FIRST_NAME=… BOOTSTRAP_ADMIN_LAST_NAME=… \
  npm run start:bootstrap-admin -w @ucrams/api
npm run start -w @ucrams/api                    # API (use a process manager: systemd, pm2)
npm run start:worker -w @ucrams/api             # worker
```

Serve `apps/web/dist` with Nginx using `docker/nginx.conf` (SPA fallback, `/api` and `/socket.io` proxy with WebSocket upgrade, security headers and CSP).

**Never run `npm run db:seed` in production** — the seed refuses `NODE_ENV=production`; it creates demo data and shared demo passwords.

## 4. Upgrades and migrations

1. Back up the database (section 5).
2. Deploy the new images/build.
3. Run `prisma migrate deploy` (Compose: the `migrate` service runs automatically before the API starts).
4. Start the API and worker; confirm `/api/v1/health/ready` reports `ok`.

Migrations are forward-only and additive by design (new tables/columns with defaults, constraints added after back-filling); they are safe to apply while the previous version is still serving. **Never use `prisma migrate reset` or `db push` against production.** To roll back, redeploy the previous version (it ignores newer, additive columns); restore the backup only if a migration changed data destructively.

## 5. Backups and restore

PostgreSQL holds everything that matters (academic records are never deleted). Redis holds only queues, caches and rate-limit counters; losing it loses at most in-flight jobs (scheduled announcements are re-published by the minute sweep). Object storage holds uploads and generated exports.

| What | How | Frequency / retention |
|---|---|---|
| PostgreSQL | Managed point-in-time recovery, or `scripts/backup-db.sh` (`pg_dump -Fc`) to off-site storage | PITR continuously; dumps nightly, keep 30 daily + 12 monthly |
| Object storage | Bucket versioning + replication, or nightly sync to a second bucket | 30 days of versions |
| Redis | AOF enabled (`--appendonly yes`) | Not required for recovery |

Restore drill (run quarterly on a staging database):

```bash
createdb -O ucrams ucrams_restore
pg_restore --no-owner --role=ucrams -d ucrams_restore backups/ucrams-YYYYMMDD-HHMM.dump
DATABASE_URL=postgresql://…/ucrams_restore npx prisma migrate status   # must report "up to date"
```

## 6. Health checks and monitoring

| Signal | Where | Alert when |
|---|---|---|
| Liveness | `GET /api/v1/health/live` | non-200 (restart the container) |
| Readiness | `GET /api/v1/health/ready` — database, Redis and storage with latencies | non-200 or `status ≠ ok` (remove from the load balancer) |
| Worker heartbeat | Redis key `ucrams:worker:heartbeat`, refreshed every minute; surfaced on the admin dashboard | older than 3 minutes |
| Failed jobs | BullMQ failed counts; surfaced on the admin dashboard ("Needs attention") | > 0 for email, exports, announcements |
| Email delivery | `email_logs` (`status = 'FAILED'` after retries) | failures in the last hour |
| Logs | JSON (Pino) on stdout with request ids; credentials and tokens redacted | error rate, 5xx rate |
| Audit | `audit_logs` and the admin audit page | role changes, grade changes, exports outside business hours (review) |

Ship stdout logs to your log platform (Loki, CloudWatch, ELK). Useful queries: `"level":50` (errors), `"statusCode":5` (5xx), `"msg":"Job failed"`.

## 7. Production checklist

- [ ] `NODE_ENV=production`, strong unique secrets, `API_DOCS_ENABLED=false`
- [ ] TLS everywhere: browser → proxy, API → PostgreSQL/Redis (managed services), cookies are `Secure`
- [ ] `CORS_ORIGINS`, `PUBLIC_API_URL`, `WEB_APP_URL` set to the real origin; `TRUST_PROXY` matches the proxy chain
- [ ] Private object-storage bucket; uploads only through presigned URLs
- [ ] Redis with `noeviction` and persistence; separate database index from anything else
- [ ] SMTP configured with SPF/DKIM for `MAIL_FROM`; send a password reset to verify
- [ ] Migrations applied (`prisma migrate status` up to date); seed **not** run
- [ ] First Super Administrator bootstrapped; personal admin accounts created; the bootstrap account's invitation used
- [ ] University profile, time zone and GPA repeat policy set; grading scales assigned to sessions
- [ ] At least one worker running; heartbeat visible on the dashboard
- [ ] Backups scheduled and a restore tested
- [ ] Health checks wired to the load balancer and alerting
- [ ] Rate limits reviewed for your traffic (`RATE_LIMIT_GLOBAL_PER_MINUTE`; per-user limits in code)
- [ ] `npm audit` clean on the deployed lockfile

## 8. Capacity notes

The registration engine serialises on the student and section rows; one API instance comfortably handles the seeded university (≈ 1,700 students). For registration opening day, run two or more API instances behind the load balancer (sockets work across instances through the Redis adapter), keep the worker separate, and run the k6 script (`load/registration.k6.js`, see TESTING.md) against staging first.
