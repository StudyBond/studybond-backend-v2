
import { FastifyRequest, FastifyReply } from 'fastify';
import { validateToken } from '../hooks/validateToken';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    await validateToken(request);
}
