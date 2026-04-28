const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  dotenv.config({ path: path.join(rootDir, '.env') });

  process.env.SWAGGER_ENABLED = process.env.SWAGGER_ENABLED || 'true';
  process.env.OPENAPI_EXPORT_MODE = 'true';
  process.env.REDIS_ENABLED = 'false';
  process.env.JOBS_ENABLED = 'false';
  process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL || 'http://localhost:5000';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  const { buildApp } = require(path.join(rootDir, 'dist', 'app.js'));
  const outputDir = path.join(rootDir, 'artifacts', 'openapi');
  const outputFile = path.join(outputDir, 'openapi.json');
  const app = await buildApp();

  try {
    await app.ready();
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputFile, JSON.stringify(app.swagger(), null, 2), 'utf8');
    console.log(`OpenAPI exported to ${outputFile}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Failed to export OpenAPI:', error);
  process.exitCode = 1;
});
