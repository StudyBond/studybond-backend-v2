import { FastifyInstance } from 'fastify';
import { requiredIdempotencyHeadersSchema } from '../../shared/idempotency/schema';
import {
  cancelSubscriptionSchema,
  initiateSubscriptionSchema,
  verifySubscriptionSchema
} from './subscriptions.schema';
import {
  cancelSubscriptionPayloadSchema,
  initiateSubscriptionPayloadSchema,
  subscriptionStatusPayloadSchema,
  subscriptionWebhookPayloadSchema,
  verifySubscriptionPayloadSchema
} from './subscriptions.openapi';
import { SubscriptionsController } from './subscriptions.controller';
import { SUBSCRIPTION_CONFIG } from '../../config/constants';
import { SubscriptionService } from './subscriptions.service';
import { successEnvelopeSchema, withStandardErrorResponses } from '../../shared/openapi/responses';

interface SubscriptionRouteOptions {
  subscriptionService: SubscriptionService;
}

export async function subscriptionsRestRoutes(
  app: FastifyInstance,
  options: SubscriptionRouteOptions
) {
  const controller = new SubscriptionsController(options.subscriptionService);
  const providerLabel = options.subscriptionService.getPaymentProviderDisplayName();

  app.get('/status', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Subscriptions'],
      summary: 'Get subscription status',
      description: 'Get the current premium subscription status for the signed-in user.',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(subscriptionStatusPayloadSchema)
      })
    }
  }, controller.getStatus as any);

  app.post('/initiate', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: SUBSCRIPTION_CONFIG.INITIATE_RATE_LIMIT_MAX,
        timeWindow: '1 hour'
      }
    },
    schema: {
      headers: requiredIdempotencyHeadersSchema,
      body: initiateSubscriptionSchema,
      tags: ['Subscriptions'],
      summary: 'Initiate subscription checkout',
      description: `Create a ${providerLabel} checkout session for the fixed 5-month StudyBond premium plan.`,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        201: successEnvelopeSchema(initiateSubscriptionPayloadSchema)
      })
    }
  }, controller.initiate as any);

  app.post('/verify', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: SUBSCRIPTION_CONFIG.VERIFY_RATE_LIMIT_MAX,
        timeWindow: '1 hour'
      }
    },
    schema: {
      headers: requiredIdempotencyHeadersSchema,
      body: verifySubscriptionSchema,
      tags: ['Subscriptions'],
      summary: 'Verify subscription payment',
      description: `Verify a ${providerLabel} transaction reference and activate premium access if payment succeeded.`,
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(verifySubscriptionPayloadSchema)
      })
    }
  }, controller.verify as any);

  app.post('/cancel', {
    preValidation: [app.authenticate],
    config: {
      rateLimit: {
        max: SUBSCRIPTION_CONFIG.CANCEL_RATE_LIMIT_MAX,
        timeWindow: '1 hour'
      }
    },
    schema: {
      headers: requiredIdempotencyHeadersSchema,
      body: cancelSubscriptionSchema,
      tags: ['Subscriptions'],
      summary: 'Cancel auto-renew intent',
      description: 'Turn off future auto-renew intent for the current premium subscription.',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(cancelSubscriptionPayloadSchema)
      })
    }
  }, controller.cancel as any);
}

export async function subscriptionsWebhookRoutes(
  app: FastifyInstance,
  options: SubscriptionRouteOptions
) {
  const controller = new SubscriptionsController(options.subscriptionService);
  const providerLabel = options.subscriptionService.getPaymentProviderDisplayName();

  app.post('/webhook', {
    schema: {
      headers: options.subscriptionService.getWebhookHeadersSchema(),
      tags: ['Subscriptions'],
      summary: 'Payment provider webhook',
      description: `${providerLabel} webhook endpoint for confirmed subscription payments.`,
      response: withStandardErrorResponses({
        200: successEnvelopeSchema(subscriptionWebhookPayloadSchema)
      })
    }
  }, controller.webhook as any);
}
