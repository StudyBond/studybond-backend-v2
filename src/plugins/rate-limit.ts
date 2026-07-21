import { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fastifyRateLimit from "@fastify/rate-limit";
import jwt from "jsonwebtoken";
import { createResilientRateLimitStore } from "./resilient-rate-limit-store";

/**
 * Extracts a per-user rate limit key.
 *
 * For authenticated requests, parses the Bearer token safely using
 * jwt.decode to obtain userId without touching Fastify's throwing getters.
 * This ensures thousands of users behind the same CGNAT IP each get their
 * own rate-limit bucket instead of sharing one.
 *
 * For anonymous requests, falls back to request.ip.
 */
function rateLimitKeyGenerator(request: FastifyRequest): string {
  try {
    const authHeader = request.headers.authorization;
    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const decoded = jwt.decode(token) as { userId?: number } | null;
        if (decoded?.userId) {
          return `usr:${decoded.userId}`;
        }
      }
    }
  } catch {
    // Fallback to IP on any token parsing error
  }

  return request.ip;
}

async function rateLimitPlugin(app: FastifyInstance) {
  const options: any = {
    // Global ceiling: 600 requests per 15 min per user/IP
    max: parseInt(process.env.RATE_LIMIT_MAX || "600", 10),
    timeWindow: process.env.RATE_LIMIT_WINDOW || "15m",

    cache: 10000,
    allowList: ["127.0.0.1"],

    // Key by user ID when possible, IP otherwise.
    keyGenerator: rateLimitKeyGenerator,

    skip: (request: any) => {
      if ((request as any).bypass_rate_limit === true) {
        return true;
      }

      const url = request.url || request.originalUrl || "";
      const pathname = url.split("?")[0];

      const criticalEndpoints = [
        "/health",
        "/",
        "/metrics",
        "/api/docs",
        "/api/openapi.json",
      ];

      return criticalEndpoints.includes(pathname);
    },
    errorResponseBuilder: (_req: any, context: any) => ({
      success: false,
      error: {
        message: `Too many requests. Try again after ${context.after}`,
        statusCode: 429,
        code: "RATE_LIMITED",
      },
    }),
  };

  if (app.cache?.available && app.cache.client) {
    const namespace =
      process.env.RATE_LIMIT_NAMESPACE || "studybond:rate-limit:";
    options.store = createResilientRateLimitStore(
      app.cache.client,
      namespace,
      app.log,
    );
    options.skipOnError = true;
    app.log.info("Rate limit is using Redis backend with local fallback.");
  } else {
    app.log.warn(
      "Rate limit is using local memory backend. Use Redis in production.",
    );
  }

  await app.register(fastifyRateLimit, options);
}

export default fp(rateLimitPlugin, {
  name: "rate-limit-plugin",
});
