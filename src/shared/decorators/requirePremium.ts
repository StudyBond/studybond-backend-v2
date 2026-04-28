import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../../config/database';
import { AuthError } from '../errors/AuthError';
import { ForbiddenError } from '../errors/ForbiddenError';

interface JWTUser {
  userId: number;
}

export async function requirePremium(request: FastifyRequest, _reply: FastifyReply) {
  const user = request.user as JWTUser | undefined;

  if (!user) {
    throw new AuthError('Please log in to continue.', 401, 'SESSION_INVALID');
  }

  const account = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isPremium: true }
  });

  if (!account?.isPremium) {
    throw new ForbiddenError('This feature requires a premium subscription.');
  }
}
