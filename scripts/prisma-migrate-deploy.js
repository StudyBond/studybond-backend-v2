const { spawnSync } = require('child_process');
const { Client } = require('pg');
require('dotenv').config();

const useIntegration = process.argv.includes('--integration');
const targetName = useIntegration ? 'integration' : 'primary';

function runPrismaCommand(args, env) {
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], {
      stdio: 'inherit',
      env
    });
  }

  return spawnSync('npx', args, {
    stdio: 'inherit',
    env
  });
}

function resolveUrl() {
  if (useIntegration) {
    return (
      process.env.INTEGRATION_DIRECT_URL ||
      process.env.INTEGRATION_DATABASE_URL ||
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL
    );
  }

  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

function assertSafeConnectionString(connectionString) {
  if (!connectionString) {
    console.error(
      `Missing database URL for ${targetName} migration. ` +
      `Set ${useIntegration ? 'INTEGRATION_DIRECT_URL/INTEGRATION_DATABASE_URL' : 'DIRECT_URL/DATABASE_URL'}.`
    );
    process.exit(1);
  }

  if (/render\.com/i.test(connectionString) && !/sslmode=require/i.test(connectionString)) {
    console.error(
      'Render PostgreSQL requires SSL. Add ?sslmode=require to the selected DIRECT_URL before running migrations.'
    );
    process.exit(1);
  }
}

async function preflightConnect(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: Number.parseInt(process.env.PGCONNECT_TIMEOUT_MS || '15000', 10)
  });

  await client.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

function runPrismaMigrate(connectionString) {
  const env = {
    ...process.env,
    DATABASE_URL: connectionString
  };

  const result = runPrismaCommand(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], env);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    console.error('');
    console.error('Prisma migrate deploy failed.');
    console.error('Safe checks:');
    console.error('- confirm the selected URL is a direct PostgreSQL connection, not a pooler');
    console.error('- confirm SSL is enabled for managed hosts like Render');
    console.error('- if the Prisma schema engine is flaky on this machine, rerun the same wrapper from Linux CI or the deploy host');
    process.exit(result.status);
  }
}

async function main() {
  const connectionString = resolveUrl();
  assertSafeConnectionString(connectionString);

  console.log(`Preflighting ${targetName} database connection...`);
  await preflightConnect(connectionString);
  console.log(`Connection OK. Running prisma migrate deploy against ${targetName} database...`);

  runPrismaMigrate(connectionString);
}

main().catch((error) => {
  const message = String(error?.message || error);
  if (message.toLowerCase().includes('timeout')) {
    console.error('Database connection timed out during migration preflight. Check reachability, firewall, and PGCONNECT_TIMEOUT_MS.');
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
