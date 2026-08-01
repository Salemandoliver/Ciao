import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { ERRORS } from "@ciao/shared";
import { config } from "./config.js";
import { CiaoError } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { listingRoutes } from "./modules/listings/routes.js";
import { bookingRoutes } from "./modules/bookings/routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { reviewRoutes } from "./modules/reviews/routes.js";
import { verificationRoutes } from "./modules/verification/routes.js";
import { opsRoutes } from "./modules/ops/routes.js";
import { hostRoutes } from "./modules/host/routes.js";
import { intelligenceRoutes } from "./modules/intelligence/routes.js";
import { wishlistRoutes } from "./modules/wishlist/routes.js";
import { trustRoutes } from "./modules/trust/routes.js";
import { businessRoutes } from "./modules/business/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(config.isProd ? {} : { transport: undefined }),
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Raw-body capture for webhook HMAC verification.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body === "" ? {} : JSON.parse(body as string));
      } catch (e) {
        done(e as Error);
      }
    },
  );
  // Mock checkout posts form data.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => {
      const def = ERRORS.RATE_LIMITED;
      return { error: { code: def.code, message: def.ar, messageEn: def.en } };
    },
  });

  app.setErrorHandler((err, req, reply) => {
    const locale = (req.headers["accept-language"] ?? "ar").startsWith("en") ? "en" : "ar";
    if (err instanceof CiaoError) {
      return reply.status(err.httpStatus).send(err.toResponse(locale));
    }
    if (err instanceof ZodError) {
      const def = ERRORS.VALIDATION;
      return reply.status(400).send({
        error: {
          code: def.code,
          message: locale === "en" ? def.en : def.ar,
          detail: err.issues,
        },
      });
    }
    req.log.error(err);
    const def = ERRORS.INTERNAL;
    return reply
      .status(500)
      .send({ error: { code: def.code, message: locale === "en" ? def.en : def.ar } });
  });

  app.get("/health", async () => ({ ok: true, service: "ciao-api" }));

  await app.register(authRoutes);
  await app.register(listingRoutes);
  await app.register(bookingRoutes);
  await app.register(paymentRoutes);
  await app.register(reviewRoutes);
  await app.register(verificationRoutes);
  await app.register(opsRoutes);
  await app.register(hostRoutes);
  await app.register(intelligenceRoutes);
  await app.register(wishlistRoutes);
  await app.register(trustRoutes);
  await app.register(businessRoutes);

  return app;
}
