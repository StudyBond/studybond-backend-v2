import Fastify, { FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import authPlugin from './modules/auth/auth.plugin';
import { examsPlugin } from './modules/exams/exams.plugin';
import questionsPlugin from './modules/questions/questions.plugin';
import adminPlugin from './modules/admin/admin.plugin';
import leaderboardPlugin from './modules/leaderboard/leaderboard.plugin';
import subscriptionsPlugin from './modules/subscriptions/subscriptions.plugin';
import usersPlugin from './modules/users/users.plugin';
import bookmarksPlugin from './modules/bookmarks/bookmarks.plugin';
import streaksPlugin from './modules/streaks/streaks.plugin';
import reportsPlugin from './modules/reports/reports.plugin';
import devToolsPlugin from './modules/devtools/devtools.plugin';
import helmetPlugin from './plugins/helmet';
import corsPlugin from './plugins/cors';
import jwtPlugin from './plugins/jwt';
import redisPlugin from './plugins/redis';
import websocketPlugin from './plugins/websocket';
import rateLimitPlugin from './plugins/rate-limit';
import swaggerPlugin from './plugins/swagger';
import prismaPlugin from './plugins/prisma';
import errorHandlerPlugin from './plugins/error-handler';
import metricsPlugin from './plugins/metrics';
import { logRequest, logResponse } from './shared/hooks/logRequest';
import { collaborationPlugin } from './modules/collaboration/collaboration.plugin';

export async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
            transport: process.env.NODE_ENV === 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                        colorize: true,
                        translateTime: 'HH:MM:ss Z',
                        ignore: 'pid,hostname'
                    }
                }
                : undefined,
        },
        requestIdLogLabel: 'reqId',
        disableRequestLogging: false,
        trustProxy: true, // Trust X-Forwarded-* headers
    });

    // Set Validator and Serializer for Zod
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', logRequest);
    app.addHook('onResponse', logResponse);

    // Deep transform dates to ISO strings globally to satisfy Zod's strict isoDateTimeSchema
    app.addHook('preSerialization', async (_request, _reply, payload) => {
        return deepStringifyDates(payload);
    });

    function deepStringifyDates(obj: unknown): unknown {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return obj.toISOString();
        if (Array.isArray(obj)) return obj.map(deepStringifyDates);
        if (Buffer.isBuffer(obj) || typeof (obj as any).pipe === 'function') return obj;
        
        const out: any = {};
        for (const key of Object.keys(obj)) {
            out[key] = deepStringifyDates((obj as any)[key]);
        }
        return out;
    }


    await app.register(helmetPlugin);
    await app.register(swaggerPlugin);
    await app.register(corsPlugin);
    await app.register(jwtPlugin);
    await app.register(redisPlugin);
    await app.register(websocketPlugin);
    await app.register(metricsPlugin);

    /* FILE UPLOADS (Multipart) */
    await app.register(fastifyMultipart, {
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB max file size
        }
    });

    await app.register(rateLimitPlugin);
    await app.register(errorHandlerPlugin);

    await app.register(prismaPlugin);
    await app.register(authPlugin, { prefix: '/api/auth' });
    await app.register(examsPlugin, { prefix: '/api' });
    await app.register(questionsPlugin, { prefix: '/api' });
    await app.register(adminPlugin, { prefix: '/api' });
    await app.register(usersPlugin, { prefix: '/api' });
    await app.register(bookmarksPlugin, { prefix: '/api' });
    await app.register(reportsPlugin, { prefix: '/api' });
    await app.register(streaksPlugin, { prefix: '/api' });
    await app.register(collaborationPlugin, { prefix: '/api' });
    await app.register(leaderboardPlugin, { prefix: '/api' });
    await app.register(subscriptionsPlugin, { prefix: '/api' });
    await app.register(devToolsPlugin, { prefix: '/internal/dev' });

    /* HEALTH CHECK ENDPOINT */
    app.get('/health', {
        schema: {
            tags: ['System'],
            summary: 'Health check',
            description: 'Basic uptime and service liveness signal.',
        }
    }, async (_req, _reply) => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV,
        };
    });

    /* ROOT ENDPOINT (API Info) */
    app.get('/', {
        schema: {
            hide: true
        }
    }, async (_req, _reply) => {
        return {
            name: 'StudyBond API',
            version: '1.0.0',
            status: 'running',
            documentation: '/api/docs',
            openapi: '/api/openapi.json',
            timestamp: new Date().toISOString(),
        };
    });

    app.log.info('Fastify app configured successfully');

    return app;
}
