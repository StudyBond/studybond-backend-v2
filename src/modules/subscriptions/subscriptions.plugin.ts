import { FastifyInstance } from 'fastify';
import { SubscriptionService } from './subscriptions.service';
import {
  subscriptionsRestRoutes,
  subscriptionsWebhookRoutes
} from './subscriptions.routes';

export default async function subscriptionsPlugin(app: FastifyInstance) {
  const subscriptionService = new SubscriptionService(app);

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        const rawBody = typeof body === 'string' ? body : body.toString();
        const parsedBody = JSON.parse(rawBody);
        done(null, { rawBody, parsedBody });
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    await scope.register(subscriptionsWebhookRoutes as any, {
      prefix: '/subscriptions',
      subscriptionService
    });
  });

  await app.register(subscriptionsRestRoutes as any, {
    prefix: '/subscriptions',
    subscriptionService
  });

  app.log.info('Subscriptions module registered');
}
