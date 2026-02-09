
import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    try {
        await request.jwtVerify();
    } catch (err) {
        throw new AppError('Unauthorized access', 401);
    }
}
