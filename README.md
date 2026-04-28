# StudyBond Backend

## Setup Instructions

### 1. Clone Repository
```bash
git clone https://github.com/YourUsername/studybond-backend.git
cd studybond-backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
```bash
# Copy template
cp .env.example .env

# Edit .env with your credentials:
# - Add YOUR PostgreSQL password
# - Generate JWT secret: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Set Up Database
```bash
# Make sure PostgreSQL is running
# Create database (if needed): createdb studybond

# Run migrations
npx prisma migrate dev
```

### 5. Start Development Server
```bash
npm run dev
```

Server should start at: http://localhost:5000

### 6. Test
- Health check: http://localhost:5000/health
- API info: http://localhost:5000
- Swagger UI: http://localhost:5000/api/docs
- OpenAPI JSON: http://localhost:5000/api/openapi.json

## API Documentation

StudyBond now exposes OpenAPI/Swagger docs so future engineers can inspect the API contract without digging through controllers and services.

- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api/openapi.json`

By default:
- enabled in non-production
- disabled in production unless `SWAGGER_ENABLED=true`

Relevant env vars:
```bash
SWAGGER_ENABLED=true
PUBLIC_API_BASE_URL=http://localhost:5000
```

Export a versionable OpenAPI file locally:
```bash
npm run build
npm run openapi:export
```

This writes:
- `artifacts/openapi/openapi.json`

Generate frontend/mobile-friendly TypeScript types from the same contract:
```bash
npm run openapi:types
```

Or do both in one step:
```bash
npm run openapi:sync
```

This also writes:
- `artifacts/openapi/openapi-types.d.ts`

CI also uploads the generated OpenAPI file as a build artifact:
- artifact name: `studybond-openapi`

Recommended client workflow:
- backend owns the contract
- CI exports `openapi.json` and `openapi-types.d.ts`
- frontend/mobile consumes the artifact instead of retyping payloads by hand

Current consumer:
- `studybond-admin/src/lib/api/types.ts` imports generated `paths` from `artifacts/openapi/openapi-types.d.ts`
- run `npm run openapi:sync` after backend schema changes before validating admin typecheck/build

## Architecture Blueprints

- Multi-institution backend refactor blueprint:
  - [multi-institution-refactor-blueprint.md](docs/multi-institution-refactor-blueprint.md)

## Question Images with Cloudinary

Question, option, and explanation images now support Cloudinary-backed lifecycle management so we can avoid leaking orphaned assets on the free tier.

Configure Cloudinary in `.env`:
```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_UPLOAD_FOLDER=studybond
CLOUDINARY_UPLOAD_TIMEOUT_MS=15000
```

How it works:
- admin question CRUD still returns normal delivery URLs for the app/runtime
- admin question CRUD can now also store Cloudinary `publicId` values for cleanup on replace/delete
- if Cloudinary is configured and an admin submits a raw remote image URL without a `publicId`, the backend imports that asset into Cloudinary automatically
- bulk question upload follows the same rule for question, option, and explanation images

Recommended admin workflow for future frontend work:
1. upload image to `POST /api/questions/assets/upload/:kind`
2. receive `{ url, publicId, ... }`
3. save that `url + publicId` pair in `POST /api/questions` or `PUT /api/questions/:id`

Supported `:kind` values:
- `question`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `optionE`
- `explanation`

Important behavior:
- deleting a question now attempts to delete its Cloudinary assets too
- replacing a question image now attempts to clean up the old Cloudinary asset after the DB update succeeds
- if Cloudinary is not configured, the backend falls back to storing the raw URLs only

Operational note:
- the standalone upload endpoint can still create abandoned assets if someone uploads and never saves the question afterward
- that tradeoff is acceptable for low-volume admin usage right now, but if admin upload volume grows we should add a scheduled orphan cleanup pass later

## Development OTP Preview Center

For local development, StudyBond can expose OTP previews through an internal non-production-only endpoint instead of leaking OTPs through normal auth responses.

Enable it explicitly:
```bash
DEV_OTP_PREVIEW_ENABLED=true
DEV_TOOLS_TOKEN=replace_with_a_long_random_non_production_token
```

What it is for:
- email verification OTP
- premium device OTP
- password reset OTP
- superadmin step-up OTP

What it is not for:
- staging/UAT by default
- production ever
- storing OTPs in the main relational database

Endpoints:
- `GET /internal/dev/otp-previews?email=user@example.com&emailType=PASSWORD_RESET_OTP&limit=1`
- `DELETE /internal/dev/otp-previews`

Required header:
```bash
x-dev-tools-token: <DEV_TOOLS_TOKEN>
```

Example:
```bash
curl "http://localhost:5000/internal/dev/otp-previews?email=user@example.com&emailType=PASSWORD_RESET_OTP&limit=1" ^
  -H "x-dev-tools-token: your-dev-tools-token"
```

Security rules:
- disabled automatically when `NODE_ENV=production`
- disabled unless `DEV_OTP_PREVIEW_ENABLED=true`
- disabled unless `DEV_TOOLS_TOKEN` is configured
- hidden from Swagger/OpenAPI

Operational note:
- previews are ephemeral
- Redis is used when available
- otherwise the backend falls back to in-memory preview storage for the current process only

## Dev Admin Seeding

For local admin testing, you do not need to open Prisma Studio or hand-write SQL each time.

You can create or promote an account directly from the backend repo:

```bash
npm run seed:superadmin -- --email you@example.com
```

Or for a standard admin:

```bash
npm run seed:admin -- --email you@example.com
```

If you want a dedicated founder shortcut, configure optional defaults in `.env`:
```bash
FOUNDER_ADMIN_EMAIL=founder@studybond.app
FOUNDER_ADMIN_NAME=StudyBond Founder
FOUNDER_ADMIN_PASSWORD=StrongPass123!
FOUNDER_ADMIN_INSTITUTION=UI
```

Then run:
```bash
npm run seed:founder
```

You can still override any of those at runtime:
```bash
npm run seed:founder -- --email founder@studybond.app --password AnotherStrongPass123!
```

Useful options:
```bash
--password StrongPass123!
--name "Your Name"
--institution UI
--dry-run
```

Examples:
```bash
npm run seed:superadmin -- --email founder@studybond.app --password StrongPass123!
npm run seed:admin -- --email ops@studybond.app --name "Ops Admin"
npm run seed:admin-user -- --email qa@studybond.app --role SUPERADMIN --dry-run
npm run seed:founder -- --dry-run
```

What the script does:
- creates the user if it does not exist
- promotes the user to `ADMIN` or `SUPERADMIN` if it already exists
- marks the account verified
- clears ban state so the account can log in locally
- preserves the existing password unless you pass `--password`

Safety rules:
- refuses to run when `NODE_ENV=production`
- refuses to target a non-local database unless you pass `--allow-remote`

If the account is new and you do not pass `--password`, the script generates a temporary password and prints it once.

## Integration Race Tests (DB-backed)

Use a dedicated test database to avoid polluting your dev/prod data.

1. Configure env vars:
```bash
INTEGRATION_DATABASE_URL=postgresql://postgres:password@localhost:5432/studybondDB_test?schema=public
INTEGRATION_DIRECT_URL=postgresql://postgres:password@localhost:5432/studybondDB_test?schema=public
INTEGRATION_AUTO_MIGRATE=false
REDIS_ENABLED=false
```

2. Run race suites:
```bash
npm run test:integration
```

This runs:
- `src/tests/integration/race-hardening.test.ts`
- `src/tests/integration/leaderboard-hardening.test.ts`
- `src/tests/e2e/collaboration-start-race.e2e.test.ts`
- `src/tests/e2e/idempotency-exams.e2e.test.ts`
- `src/tests/e2e/leaderboard.e2e.test.ts`
- `src/tests/e2e/leaderboard-integrity.e2e.test.ts`

Optional:
- Set `INTEGRATION_AUTO_MIGRATE=true` if you want the runner to execute `prisma migrate deploy` automatically before tests.
- Set `INTEGRATION_REDIS_ENABLED=true` and `INTEGRATION_REDIS_URL=redis://127.0.0.1:6379` to run Redis-backed paths in integration tests.
- Increase `PGCONNECT_TIMEOUT_MS` when your DB is reachable but slow to accept initial connections.

## Development Workflow

- Create feature branch: `git checkout -b feature/your-feature`
- Commit changes: `git commit -m "feat: description"`
- Push branch: `git push origin feature/your-feature`
- Create Pull Request on GitHub

## Tech Stack
- Node.js 20.x
- TypeScript 5.x
- Fastify 5.x
- Prisma 7.2
- PostgreSQL 15+

## Redis Setup (Docker)

### Why Redis is useful in current backend
- Distributed rate limiting (critical for multi-instance deploys).
- Per-user exam start throttling (protects DB during burst abuse).
- Distributed exam submit lock (prevents duplicate concurrent submissions).
- Exam history response cache (`GET /api/exams/history`) with short TTL.
- Fast cache invalidation via version bump when exam state changes (start/submit/retake/abandon).

### 1. Start Redis with Docker
```bash
docker compose -f docker-compose.redis.yml up -d
```

### 2. Enable Redis in backend env
Set these in `.env`:
```bash
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
RATE_LIMIT_NAMESPACE=studybond:rate-limit
EXAM_START_RATE_LIMIT_MAX=5
EXAM_START_RATE_LIMIT_WINDOW_SECONDS=60
EXAM_SUBMIT_LOCK_TTL_SECONDS=30
EXAM_HISTORY_CACHE_TTL_SECONDS=45
```

### 3. Install Redis client dependencies
```bash
npm install @fastify/redis ioredis
```

### 4. Run backend
```bash
npm run dev
```

### 5. Verify
- API boots and logs `Redis connected successfully`.
- Rate-limit plugin logs Redis backend usage.
- Redis Insight UI: `http://localhost:5540`.

### 6. Stop Redis
```bash
docker compose -f docker-compose.redis.yml down
```

## Hardening v4 Notes

### Idempotency-Key rollout
- Critical mutating endpoints support `Idempotency-Key`.
- In grace mode (`IDEMPOTENCY_ENFORCEMENT_STRICT=false`), missing keys are auto-generated server-side.
- In strict mode (`IDEMPOTENCY_ENFORCEMENT_STRICT=true`), missing keys are rejected with `IDEMPOTENCY_KEY_REQUIRED`.

### Metrics endpoint
- Endpoint: `GET /internal/metrics`
- Production usage requires:
  - `METRICS_TOKEN=<secret>`
  - request header `x-metrics-token: <secret>`

### Load test scripts (k6)
```bash
npm run load:smoke
npm run load:mixed
npm run load:leaderboard
npm run test:integration
```

### Install k6 (Windows)
Choose one:

```bash
# Winget (recommended)
winget install k6.k6
```

```bash
# Chocolatey
choco install k6
```

```bash
# Scoop
scoop install k6
```

```bash
# Docker (no host install)
docker run --rm -i grafana/k6 run - < load-tests/smoke.js
```

Verify install:
```bash
k6 version
```

### Leaderboard module
Endpoints:
- `GET /api/leaderboard/weekly?limit=50`
- `GET /api/leaderboard/all-time?limit=50`
- `GET /api/leaderboard/my-rank`

Ranking/tie-break order:
- Weekly: `weeklySp DESC`, then `totalSp DESC`, then `id ASC`
- All-time: `totalSp DESC`, then `weeklySp DESC`, then `id ASC`

Weekly reset job:
- Implemented with DB snapshot into `WeeklyLeaderboard` + `weeklySp` reset.
- Runs from dedicated worker process (not API server cron).
- Schedule: `LEADERBOARD_WEEKLY_RESET_CRON` in `JOBS_TIMEZONE` (default `Africa/Lagos`).

Leaderboard worker:
```bash
npm run worker:leaderboard
npm run worker:leaderboard:once
```

Projection/anti-abuse flags:
- `LEADERBOARD_PROJECTION_ENABLED`
- `LEADERBOARD_REDIS_READ_ENABLED`
- `LEADERBOARD_TIE_BUFFER`
- `LEADERBOARD_PROJECTION_STALE_SECONDS`
- `LEADERBOARD_SIGNAL_HIGH_SCORE_PERCENT`
- `LEADERBOARD_SIGNAL_LOW_TIME_SECONDS_PER_QUESTION`
- `LEADERBOARD_SIGNAL_SP_VELOCITY_LIMIT_5M`

Common environment variables:
```bash
BASE_URL=http://localhost:5000
ACCESS_TOKEN=<jwt>
REFRESH_TOKEN=<refresh>
EXAM_ID=1
COLLAB_CODE=ABCD1234
COLLAB_SESSION_ID=1
```
