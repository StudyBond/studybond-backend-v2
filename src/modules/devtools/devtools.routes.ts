import { FastifyInstance } from 'fastify';
import { devToolsController } from './devtools.controller';
import { devToolsTokenHeadersSchema, otpPreviewQuerySchema } from './devtools.schema';

export async function devToolsRoutes(app: FastifyInstance) {
  app.get('/otp-previews', {
    schema: {
      hide: true,
      headers: devToolsTokenHeadersSchema,
      querystring: otpPreviewQuerySchema
    }
  }, devToolsController.listOtpPreviews);

  app.delete('/otp-previews', {
    schema: {
      hide: true,
      headers: devToolsTokenHeadersSchema,
      querystring: otpPreviewQuerySchema
    }
  }, devToolsController.clearOtpPreviews);
}
