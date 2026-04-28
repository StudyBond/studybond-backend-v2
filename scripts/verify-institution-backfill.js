const { Client } = require('pg');
require('dotenv').config();

const useIntegration = process.argv.includes('--integration');
const targetName = useIntegration ? 'integration' : 'primary';
const scopedTables = [
  'Question',
  'Exam',
  'CollaborationSession',
  'WeeklyLeaderboard',
  'LeaderboardProjectionEvent',
  'LeaderboardIntegritySignal'
];

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

async function main() {
  const connectionString = resolveUrl();

  if (!connectionString) {
    console.error(
      `Missing database URL for ${targetName} institution verification. ` +
      `Set ${useIntegration ? 'INTEGRATION_DIRECT_URL/INTEGRATION_DATABASE_URL' : 'DIRECT_URL/DATABASE_URL'}.`
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: Number.parseInt(process.env.PGCONNECT_TIMEOUT_MS || '15000', 10)
  });

  await client.connect();
  try {
    const uiInstitution = await client.query(
      'SELECT "id", "code", "name" FROM "Institution" WHERE "code" = $1 LIMIT 1',
      ['UI']
    );

    if (uiInstitution.rowCount !== 1) {
      console.error('Institution verification failed: expected seeded UI institution to exist.');
      process.exit(1);
    }

    const nullCounts = [];
    for (const tableName of scopedTables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "institutionId" IS NULL`
      );
      nullCounts.push({
        tableName,
        count: Number.parseInt(String(result.rows[0]?.count ?? '0'), 10)
      });
    }

    const remainingNulls = nullCounts.filter((entry) => entry.count > 0);

    console.log(`Institution scope verification target: ${targetName}`);
    console.log(`Resolved launch institution: UI (#${uiInstitution.rows[0].id})`);
    for (const entry of nullCounts) {
      console.log(`- ${entry.tableName}: ${entry.count} null institutionId rows`);
    }

    if (remainingNulls.length > 0) {
      console.error('');
      console.error('Institution backfill verification failed. Remaining null-scoped rows exist.');
      process.exit(1);
    }

    console.log('');
    console.log('Institution backfill verification passed. All scoped rows are explicitly assigned to an institution.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = String(error?.message || error);
  if (message.toLowerCase().includes('timeout')) {
    console.error(
      'Institution verification timed out while connecting to PostgreSQL. ' +
      'Check reachability, firewall rules, and PGCONNECT_TIMEOUT_MS.'
    );
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
