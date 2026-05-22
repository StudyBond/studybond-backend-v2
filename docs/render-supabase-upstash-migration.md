# Railway to Supabase, Upstash, and Render Migration Runbook

## Target Topology

- `studybond-backend-api`: Render web service
- `studybond-backend-jobs`: Render background worker for cron-style jobs
- `studybond-backend-leaderboard`: Render background worker for leaderboard projection and weekly reset
- Supabase PostgreSQL: primary relational database
- Upstash Redis: cache, locks, pub/sub, websocket leases, OTP preview storage, and leaderboard projection state

## Why This Fits the Current Codebase

- Prisma already targets PostgreSQL, so the database move is provider-level, not ORM-level.
- Redis usage is largely ephemeral or rebuildable:
  - rate limits
  - idempotency and exam submit locks
  - websocket ownership leases
  - OTP preview cache
  - pub/sub fanout
  - leaderboard projection snapshots
- The repo now has a dedicated jobs worker plus a dedicated leaderboard worker, which maps directly to Render's worker model.

## Provider Decisions

- Render plan: use at least `starter` for the API and both workers.
- Render region: keep Render, Supabase, and Upstash in the same general geography. For StudyBond's current setup, Frankfurt/Europe is a sensible default.
- Supabase connection mode from Render: use the Supavisor session-mode connection string on port `5432`.
- Supabase direct connection: use only if you have confirmed IPv6 connectivity or bought Supabase's IPv4 add-on.
- Upstash Redis: use the TCP/TLS connection string that starts with `rediss://`.

## Shared Render Env Group

The root [`render.yaml`](../../render.yaml) creates a shared env group named `studybond-backend-production`.

Add these values manually in Render before the first real deploy:

- `DATABASE_URL`: Supabase session-mode connection string on port `5432`
- `DIRECT_URL`: same as `DATABASE_URL` at first; switch later only if you have a verified direct/non-pooler endpoint
- `REDIS_URL`: Upstash `rediss://...` TCP connection string
- `JWT_SECRET`: copy the current Railway production value
- `REFRESH_TOKEN_SECRET`: copy the current Railway production value
- `CORS_ORIGIN`: comma-separated learner/admin frontend origins
- `PUBLIC_API_BASE_URL`: the final Render API URL, for example `https://studybond-backend-api.onrender.com`
- `METRICS_TOKEN`: long random token for `/internal/metrics`
- `PAYSTACK_SECRET_KEY` and `PAYSTACK_CALLBACK_URL`
- `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO_ADDRESS`
- `BREVO_API_KEY` or `RESEND_API_KEY`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Any other non-default production values currently living in Railway env vars

## Frontend Env Changes

After Render is healthy, update these Vercel variables:

- `studybond-web`
  - `BACKEND_API_BASE_URL=https://<render-api-host>`
- `studybond-admin`
  - `BACKEND_API_BASE_URL=https://<render-api-host>`
  - `NEXT_PUBLIC_API_BASE_URL=https://<render-api-host>`

## Database Migration Sequence

1. Freeze writes.
   - Schedule a short maintenance window.
   - Avoid running admin mutations while the dump/restore is in flight.

2. Back up Railway Postgres.
```bash
pg_dump --format=custom --no-owner --no-privileges --file studybond-railway.dump "$RAILWAY_DATABASE_URL"
```

3. Create the Supabase project.
   - Choose the closest region available to the planned Render region.
   - Copy the session-mode connection string from the Supabase connection panel.

4. Restore the dump into Supabase.
```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$SUPABASE_DATABASE_URL" studybond-railway.dump
```

5. Validate schema state.
```bash
npm run prisma:migrate:status
npm run prisma:migrate:deploy
```

6. Smoke-test the restored data before public cutover.
   - verify a known user can still log in
   - verify admin data loads
   - verify leaderboard endpoints return expected rows

## Redis Migration Sequence

Do not migrate Railway Redis data into Upstash.

Why:

- Redis contents in this backend are short-lived coordination state or derived cache data.
- Copying old locks, rate limits, websocket leases, or pub/sub channels is more likely to create stale behavior than to help.
- Leaderboard projection data can be rebuilt from PostgreSQL.

Bring Upstash online empty, then warm derived state after deploy:

```bash
npm run worker:leaderboard:prod:once
```

## Render Deployment Sequence

1. Commit and push the repo changes that introduced:
   - [`render.yaml`](../../render.yaml)
   - jobs worker entrypoint
   - provider-aware migration guidance

2. Create the Render Blueprint from the repo root.

3. Populate the shared env group `studybond-backend-production`.

4. Deploy the services:
   - `studybond-backend-api`
   - `studybond-backend-jobs`
   - `studybond-backend-leaderboard`

5. Verify service roles:
   - API service has `JOBS_ENABLED=false`
   - jobs worker has `JOBS_ENABLED=true`
   - leaderboard worker has `JOBS_ENABLED=false`

## Verification Checklist

Run these checks in order:

1. API health:
```bash
curl https://<render-api-host>/health
```

2. Auth:
   - register
   - OTP verify
   - login
   - refresh token
   - logout

3. Admin:
   - admin login
   - dashboard loads
   - analytics loads
   - user search works

4. Core learner flows:
   - start practice exam
   - submit exam
   - view exam history
   - bookmark flow

5. Collaboration:
   - create duel/collab session
   - join from another browser/device
   - confirm websocket events flow across instances

6. Leaderboard:
   - `GET /api/leaderboard/weekly`
   - `GET /api/leaderboard/all-time`
   - `GET /api/leaderboard/my-rank`
   - review leaderboard worker logs for projection/reconciliation activity

7. Background operations:
   - check jobs worker logs for analytics rollups, reminders, cleanup jobs, and alerts
   - verify no duplicate cron execution appears in logs

8. External integrations:
   - payment initiation/verification
   - email delivery
   - question image upload/delete

## Rollback Plan

- Keep Railway Postgres and Railway backend intact until Render has passed smoke tests.
- If cutover fails, point Vercel `BACKEND_API_BASE_URL` variables back to the Railway backend URL.
- Disable or scale down the Render services.
- Keep the Supabase snapshot for diffing and postmortem.

## Official References

- Supabase Prisma guide: https://supabase.com/docs/guides/database/prisma
- Supabase connection strings: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Upstash Redis client connection guide: https://upstash.com/docs/redis/howto/connectclient
- Upstash Redis command compatibility: https://upstash.com/docs/redis/overall/rediscompatibility
- Render Blueprint spec: https://render.com/docs/blueprint-spec
- Render WebSockets support: https://render.com/docs/websocket
