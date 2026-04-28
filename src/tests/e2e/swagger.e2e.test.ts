import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

describeE2E('Swagger / OpenAPI docs', () => {
  it('serves an OpenAPI document with key StudyBond routes', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/openapi.json'
      });

      expect(response.statusCode).toBe(200);
      const document = response.json();

      expect(document.openapi).toBeTruthy();
      expect(document.info?.title).toBe('StudyBond API');
      expect(document.components?.securitySchemes?.bearerAuth).toBeTruthy();
      const pathKeys = Object.keys(document.paths || {});

      expect(pathKeys).toContain('/api/auth/login');
      expect(pathKeys).toContain('/api/exams/start');
      expect(pathKeys.some((path) => path.startsWith('/api/admin/reports'))).toBe(true);
      expect(pathKeys).toContain('/api/subscriptions/initiate');
      expect(pathKeys).toContain('/api/admin/analytics/overview');
      expect(pathKeys).toContain('/api/collaboration/sessions/{sessionId}');

      const questionParams = document.paths?.['/api/questions']?.get?.parameters || [];
      expect(questionParams.some((param: { name?: string }) => param?.name === 'year')).toBe(false);

      const adminOverviewSchema = document.paths?.['/api/admin/analytics/overview']?.get?.responses?.['200']?.content?.['application/json']?.schema;
      expect(adminOverviewSchema).toBeTruthy();

      const collaborationSchema = document.paths?.['/api/collaboration/sessions/{sessionId}']?.get?.responses?.['200']?.content?.['application/json']?.schema;
      expect(collaborationSchema).toBeTruthy();
    } finally {
      await app.close();
    }
  }, 120000);
});
