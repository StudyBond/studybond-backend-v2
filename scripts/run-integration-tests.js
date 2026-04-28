const { spawnSync } = require('child_process');
const { Client } = require('pg');
require('dotenv').config();

function run(command, args, env) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
        stdio: 'inherit',
        env
      })
    : spawnSync(command, args, {
        stdio: 'inherit',
        env
      });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function runVitestFile(testFile, env) {
  run(
    'npx',
    [
      'vitest',
      'run',
      '--testTimeout=45000',
      '--hookTimeout=45000',
      testFile
    ],
    env
  );
}

async function getMissingTables(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: Number.parseInt(process.env.PGCONNECT_TIMEOUT_MS || '15000', 10)
  });
  const required = [
    'public."User"',
    'public."Exam"',
    'public."CollaborationSession"',
    'public."IdempotencyRecord"',
    'public."AdminStepUpChallenge"',
    'public."LeaderboardProjectionEvent"',
    'public."LeaderboardIntegritySignal"',
    'public."PremiumEntitlement"',
    'public."SubscriptionPayment"'
  ];
  const missing = [];

  await client.connect();
  try {
    for (const tableName of required) {
      const result = await client.query('SELECT to_regclass($1) AS table_name', [tableName]);
      if (!result.rows[0] || !result.rows[0].table_name) {
        missing.push(tableName);
      }
    }
  } finally {
    await client.end();
  }

  return missing;
}

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!integrationDatabaseUrl) {
  console.error('Missing database URL. Set INTEGRATION_DATABASE_URL (recommended) or DATABASE_URL.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run integration tests with NODE_ENV=production.');
  process.exit(1);
}

if (!process.env.INTEGRATION_DATABASE_URL) {
  console.warn('INTEGRATION_DATABASE_URL is not set. Falling back to DATABASE_URL for integration tests.');
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  RUN_INTEGRATION_TESTS: 'true',
  DATABASE_URL: integrationDatabaseUrl,
  DIRECT_URL: process.env.INTEGRATION_DIRECT_URL || process.env.DIRECT_URL || integrationDatabaseUrl,
  PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '10',
  REDIS_ENABLED: process.env.INTEGRATION_REDIS_ENABLED === 'true' ? 'true' : 'false',
  REDIS_URL: process.env.INTEGRATION_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'integration-jwt-secret',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'integration-refresh-secret'
};

async function main() {
  const autoMigrate = String(process.env.INTEGRATION_AUTO_MIGRATE ?? 'false').trim().toLowerCase() === 'true';
  let missing;
  try {
    missing = await getMissingTables(integrationDatabaseUrl);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes('timeout')) {
      console.error(
        'Failed to connect to integration database (timeout). ' +
        'Check INTEGRATION_DATABASE_URL reachability/firewall and increase PGCONNECT_TIMEOUT_MS if needed.'
      );
      process.exit(1);
    }
    throw error;
  }

  if (missing.length > 0 && autoMigrate) {
    console.log('Integration schema missing tables. Running prisma migrate deploy...');
    const migrateEnv = {
      ...env,
      DATABASE_URL: env.DIRECT_URL || env.DATABASE_URL
    };
    run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], migrateEnv);
    missing = await getMissingTables(integrationDatabaseUrl);
  }

  if (missing.length > 0) {
    console.error(
      `Integration schema is incomplete. Missing tables: ${missing.join(', ')}. ` +
      'Run migrations first or set INTEGRATION_AUTO_MIGRATE=true in an environment that allows Prisma engines.'
    );
    process.exit(1);
  }

  const defaultTestFiles = [
    'src/tests/integration/race-hardening.test.ts',
    'src/tests/integration/leaderboard-hardening.test.ts',
    'src/tests/integration/institution-scope-defaults.test.ts',
    'src/tests/integration/institution-context-resolution.test.ts',
    'src/tests/e2e/admin-hardening.e2e.test.ts',
    'src/tests/e2e/admin-analytics.e2e.test.ts',
    'src/tests/e2e/admin-user-360.e2e.test.ts',
    'src/tests/e2e/admin-step-up.e2e.test.ts',
    'src/tests/e2e/admin-premium-management.e2e.test.ts',
    'src/tests/e2e/auth-device-policy.e2e.test.ts',
    'src/tests/e2e/auth-password-reset.e2e.test.ts',
    'src/tests/e2e/dev-otp-preview.e2e.test.ts',
    'src/tests/e2e/swagger.e2e.test.ts',
    'src/tests/e2e/users.e2e.test.ts',
    'src/tests/e2e/bookmarks.e2e.test.ts',
    'src/tests/e2e/reports.e2e.test.ts',
    'src/tests/e2e/streaks.e2e.test.ts',
    'src/tests/e2e/free-real-exam-limits.e2e.test.ts',
    'src/tests/e2e/questions-free-pool.e2e.test.ts',
    'src/tests/e2e/collaboration-start-race.e2e.test.ts',
    'src/tests/e2e/idempotency-exams.e2e.test.ts',
    'src/tests/e2e/leaderboard.e2e.test.ts',
    'src/tests/e2e/leaderboard-integrity.e2e.test.ts',
    'src/tests/e2e/subscriptions.e2e.test.ts'
  ];

  const requestedFiles = process.argv.slice(2);
  const testFiles = requestedFiles.length > 0 ? requestedFiles : defaultTestFiles;

  for (const testFile of testFiles) {
    console.log(`Running integration suite: ${testFile}`);
    runVitestFile(testFile, env);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
