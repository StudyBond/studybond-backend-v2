import 'dotenv/config';
import { buildApp } from './app';
import { setupBackgroundJobs } from './jobs';

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

let server: Awaited<ReturnType<typeof buildApp>> | null = null;

async function startServer() {
  try {
    server = await buildApp();
    setupBackgroundJobs(server);

    await server.listen({ port: PORT, host: HOST });

    server.log.info('='.repeat(50));
    server.log.info('StudyBond API Server Started');
    server.log.info(`URL: http://${HOST}:${PORT}`);
    server.log.info(`ENV: ${process.env.NODE_ENV || 'development'}`);
    server.log.info(`PID: ${process.pid}`);
    server.log.info('='.repeat(50));

  } catch (error) {
    console.error('Server startup failed');
    console.error(error);
    process.exit(1);
  }
}

/* Graceful Shutdown */

async function shutdown(signal: string) {
  if (!server) {
    process.exit(0);
  }

  server.log.warn({ signal }, 'Shutdown signal received');

  try {
    // Stop accepting new connections
    await server.close();

    server.log.info('HTTP server closed');

    server.log.info('Cleanup complete');
    process.exit(0);

  } catch (error) {
    server.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

(['SIGINT', 'SIGTERM'] as const).forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

/* Last resort error handler*/

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer();
