const { spawnSync } = require('child_process');
require('dotenv').config();

const useIntegration = process.argv.includes('--integration');

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

const connectionString = useIntegration
  ? (process.env.INTEGRATION_DIRECT_URL || process.env.INTEGRATION_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL)
  : (process.env.DIRECT_URL || process.env.DATABASE_URL);

if (!connectionString) {
  console.error(
    `Missing database URL for ${useIntegration ? 'integration' : 'primary'} migration status. ` +
    `Set ${useIntegration ? 'INTEGRATION_DIRECT_URL/INTEGRATION_DATABASE_URL' : 'DIRECT_URL/DATABASE_URL'}.`
  );
  process.exit(1);
}

const result = runPrismaCommand(
  ['prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'],
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
