import { FastifyReply, FastifyRequest } from 'fastify';
import { SubscriptionService } from './subscriptions.service';
import {
  CancelSubscriptionInput,
  InitiateSubscriptionInput,
  SubscriptionRequestContext,
  VerifySubscriptionInput
} from './subscriptions.types';
import { RawWebhookBody } from './payment-provider';

export class SubscriptionsController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  private getRequestContext(request: FastifyRequest): SubscriptionRequestContext {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      correlationId: (request as any).correlationId || request.id,
      idempotencyKey: typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined
    };
  }

  getStatus = async (request: FastifyRequest, reply: FastifyReply) => {
    const authRequest = request as FastifyRequest & { user: { userId: number } };
    const data = await this.subscriptionService.getStatus(authRequest.user.userId);
    return reply.send({ success: true, data });
  };

  initiate = async (
    request: FastifyRequest<{ Body: InitiateSubscriptionInput }>,
    reply: FastifyReply
  ) => {
    const authRequest = request as FastifyRequest<{ Body: InitiateSubscriptionInput }> & {
      user: { userId: number };
    };
    const data = await this.subscriptionService.initiateSubscription(
      authRequest.user.userId,
      authRequest.body,
      this.getRequestContext(authRequest)
    );

    return reply.status(201).send({ success: true, data });
  };

  verify = async (
    request: FastifyRequest<{ Body: VerifySubscriptionInput }>,
    reply: FastifyReply
  ) => {
    const authRequest = request as FastifyRequest<{ Body: VerifySubscriptionInput }> & {
      user: { userId: number };
    };
    const data = await this.subscriptionService.verifySubscription(
      authRequest.user.userId,
      authRequest.body,
      this.getRequestContext(authRequest)
    );

    return reply.send({ success: true, data });
  };

  cancel = async (
    request: FastifyRequest<{ Body: CancelSubscriptionInput }>,
    reply: FastifyReply
  ) => {
    const authRequest = request as FastifyRequest<{ Body: CancelSubscriptionInput }> & {
      user: { userId: number };
    };
    const data = await this.subscriptionService.cancelSubscription(
      authRequest.user.userId,
      authRequest.body,
      this.getRequestContext(authRequest)
    );

    return reply.send({ success: true, data });
  };

  webhook = async (
    request: FastifyRequest<{ Body: RawWebhookBody }>,
    reply: FastifyReply
  ) => {
    await this.subscriptionService.handleWebhook(
      this.subscriptionService.extractWebhookSignature(request.headers as Record<string, unknown>),
      request.body.rawBody,
      request.body.parsedBody
    );

    return reply.send({
      success: true,
      data: {
        received: true
      }
    });
  };
}
