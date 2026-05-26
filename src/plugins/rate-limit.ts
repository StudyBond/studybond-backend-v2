import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fastifyRateLimit from "@fastify/rate-limit";
import { createResilientRateLimitStore } from "./resilient-rate-limit-store";

async function rateLimitPlugin(app: FastifyInstance) {
  const options: any = {
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    timeWindow: process.env.RATE_LIMIT_WINDOW || "15m",
    cache: 10000,
    allowList: ["127.0.0.1"],
    skip: (request: any) => {
      // Skip rate limiting for health check endpoint
      return request.url === "/health";
    },
    errorResponseBuilder: (_req: any, context: any) => ({
      success: false,
      message: `Too many requests. Try again after ${context.after}`,
      statusCode: 429,
      error: "Too Many Requests",
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
