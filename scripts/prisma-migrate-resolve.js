const { spawnSync } = require('child_process');
require('dotenv').config();

const useIntegration = process.argv.includes('--integration');
const args = process.argv.slice(2).filter((arg) => arg !== '--integration');

function runPrismaCommand(commandArgs, env) {
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx ${commandArgs.join(' ')}`], {
      stdio: 'inherit',
      env
    });
  }

  return spawnSync('npx', commandArgs, {
    stdio: 'inherit',
    env
  });
}

const connectionString = useIntegration
  ? (process.env.INTEGRATION_DIRECT_URL || process.env.INTEGRATION_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL)
  : (process.env.DIRECT_URL || process.env.DATABASE_URL);

if (!connectionString) {
  console.error(
    `Missing database URL for ${useIntegration ? 'integration' : 'primary'} migrate resolve. ` +
    `Set ${useIntegration ? 'INTEGRATION_DIRECT_URL/INTEGRATION_DATABASE_URL' : 'DIRECT_URL/DATABASE_URL'}.`
  );
  process.exit(1);
}

if (args.length !== 2 || !['--applied', '--rolled-back'].includes(args[0])) {
  console.error('Usage: node scripts/prisma-migrate-resolve.js [--integration] --applied <migration_name>');
  console.error('   or: node scripts/prisma-migrate-resolve.js [--integration] --rolled-back <migration_name>');
  process.exit(1);
}

const result = runPrismaCommand(
  ['prisma', 'migrate', 'resolve', args[0], args[1], '--schema', 'prisma/schema.prisma'],
  {
    ...process.env,
    DATABASE_URL: connectionString
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}
