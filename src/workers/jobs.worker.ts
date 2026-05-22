import 'dotenv/config';
import { buildApp } from '../app';
import { setupBackgroundJobs } from '../jobs';

let app: Awaited<ReturnType<typeof buildApp>> | null = null;

async function start(): Promise<void> {
  if (process.env.JOBS_ENABLED !== 'true') {
    throw new Error('JOBS_ENABLED must be true when running the jobs worker.');
  }

  app = await buildApp();
  setupBackgroundJobs(app);

  app.log.info(
    {
      pid: process.pid,
      timezone: process.env.JOBS_TIMEZONE || 'Africa/Lagos'
    },
    'StudyBond jobs worker started'
  );
}

async function shutdown(signal: string): Promise<void> {
  if (!app) {
    process.exit(0);
  }

  app.log.warn({ signal }, 'Jobs worker shutdown signal received');

  try {
    await app.close();
    app.log.info('Jobs worker closed cleanly');
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, 'Jobs worker shutdown failed');
    process.exit(1);
  }
}

(['SIGINT', 'SIGTERM'] as const).forEach((signal) => {
  process.on(signal, () => void shutdown(signal));
});

process.on('unhandledRejection', (reason) => {
  console.error('Jobs worker unhandled rejection:', reason);
  void shutdown('UNHANDLED_REJECTION');
});

process.on('uncaughtException', (error) => {
  console.error('Jobs worker uncaught exception:', error);
  void shutdown('UNCAUGHT_EXCEPTION');
});

start().catch((error) => {
  console.error('Jobs worker startup failed');
  console.error(error);
  process.exit(1);
});
