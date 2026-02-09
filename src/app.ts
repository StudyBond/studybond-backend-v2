import Fastify, { FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import prisma, { connectDatabase } from './config/database';
import { authPlugin } from './modules/auth/auth.plugin';
import { examsPlugin } from './modules/exams/exams.plugin';
import { questionsRoutes } from './modules/questions/questions.routes';
import adminPlugin from './modules/admin/admin.plugin';

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


    /* Security Headers (Helmet)*/
    await app.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
            },
        },
        // HSTS: Force HTTPS (in production)
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true
        },
    });

    /* SWAGGER DOCUMENTATION */
    if (process.env.NODE_ENV !== 'production') {
        const swagger = await import('@fastify/swagger');
        const swaggerUi = await import('@fastify/swagger-ui');

        await app.register(swagger.default, {
            swagger: {
                info: {
                    title: 'StudyBond API',
                    description: 'StudyBond Backend API Documentation',
                    version: '1.0.0'
                },
                host: 'localhost:5000',
                schemes: ['http'],
                consumes: ['application/json'],
                produces: ['application/json'],
                securityDefinitions: {
                    apiKey: {
                        type: 'apiKey',
                        name: 'Authorization',
                        in: 'header'
                    }
                }
            }
        });

        await app.register(swaggerUi.default, {
            routePrefix: '/api/docs',
            uiConfig: {
                docExpansion: 'list',
                deepLinking: false
            },
            staticCSP: true,
            transformStaticCSP: (header) => header
        });
    }

    /* CORS */
    await app.register(fastifyCors, {
        origin: (origin, callback) => {
            // In development: Allow any origin
            if (process.env.NODE_ENV === 'development') {
                callback(null, true);
                return;
            }

            // In production: Only allow specific origins
            const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];

            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'), false);
            }
        },
        credentials: true, // Allow cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    });

    /* JWT AUTHENTICATION */
    await app.register(fastifyJwt, {
        secret: process.env.JWT_SECRET!,
        sign: {
            expiresIn: process.env.JWT_EXPIRY || '15m',
        },
    });

    app.decorate('authenticate', async (request: any, reply: any) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.send(err);
        }
    });

    /* FILE UPLOADS (Multipart) */
    await app.register(fastifyMultipart, {
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB max file size
        }
    });

    /* RATE LIMITING */
    await app.register(fastifyRateLimit, {
        max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
        timeWindow: process.env.RATE_LIMIT_WINDOW || '15m',
        cache: 10000, // Track up to 10k different IPs
        allowList: ['127.0.0.1'], // Never rate limit localhost (for testing)
        errorResponseBuilder: (_req, context) => ({
            success: false,
            message: `Too many requests. Try again after ${context.after}`,
            statusCode: 429,
            error: 'Too Many Requests',
        }),
    });

    /*DATABASE CONNECTION */
    try {
        await connectDatabase();
        app.decorate('prisma', prisma);
        app.log.info('✅ Prisma client decorated on app instance');
    } catch (error) {
        app.log.error('❌ Failed to connect to database');
        throw error;
    }
    await app.register(authPlugin, { prefix: '/api/auth' });
    await app.register(examsPlugin, { prefix: '/api/exams' });
    await app.register(questionsRoutes, { prefix: '/api/questions' });
    await app.register(adminPlugin);

    /* HEALTH CHECK ENDPOINT */
    app.get('/health', async (_req, _reply) => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV,
        };
    });

    /* ROOT ENDPOINT (API Info) */
    app.get('/', async (_req, _reply) => {
        return {
            name: 'StudyBond API',
            version: '1.0.0',
            status: 'running',
            documentation: '/api/docs', // We'll add Swagger later
            timestamp: new Date().toISOString(),
        };
    });

    /* GLOBAL ERROR HANDLER */
    app.setErrorHandler((error: any, req, reply) => {
        // Log the full error (with stack trace) for debugging
        req.log.error({
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code,
            },
            request: {
                method: req.method,
                url: req.url,
                params: req.params,
                query: req.query,
            },
        }, 'Request error');

        const statusCode = error.statusCode || 500;
        return reply.status(statusCode).send({
            success: false,
            error: {
                message: error.message || 'Internal Server Error',
                statusCode,
                // Only show stack in development
                ...(process.env.NODE_ENV === 'development' && {
                    stack: error.stack
                }),
            },
            timestamp: new Date().toISOString(),
        });
    });

    /* 404 HANDLER */
    app.setNotFoundHandler((req, reply) => {
        req.log.warn({
            method: req.method,
            url: req.url,
        }, 'Route not found');

        return reply.status(404).send({
            success: false,
            error: {
                message: `Route ${req.method} ${req.url} not found`,
                statusCode: 404,
            },
            timestamp: new Date().toISOString(),
        });
    });

    /* REQUEST LOGGING HOOK */
    app.addHook('onRequest', async (req, _reply) => {
        req.log.info({
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        }, 'Incoming request');
    });

    /* RESPONSE LOGGING HOOK */
    app.addHook('onResponse', async (req, reply) => {
        req.log.info({
            method: req.method,
            url: req.url,
            statusCode: reply.statusCode,
            responseTime: reply.elapsedTime, // In milliseconds
        }, 'Request completed');
    });

    app.log.info('✅ Fastify app configured successfully');

    return app;
}