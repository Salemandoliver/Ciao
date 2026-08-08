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
import { accountRoutes } from "./modules/accounts/routes.js";
import { partnerRoutes } from "./modules/partner/routes.js";
import { partnerAuthRoutes } from "./modules/partner/auth-routes.js";
import { partnerCatalogueRoutes } from "./modules/partner/catalogue-routes.js";
import { bizAuthRoutes } from "./modules/business/auth-routes.js";
import { bizMessagingRoutes } from "./modules/business/messaging-routes.js";
import { partnerLeadRoutes } from "./modules/business/leads-routes.js";
import { venueRoutes } from "./modules/listings/venue-routes.js";
import { waitlistRoutes } from "./modules/listings/waitlist-routes.js";
import { mediaRoutes } from "./modules/media/routes.js";
import { flashOfferRoutes } from "./modules/partner/offer-routes.js";

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
    /*
     * The global cap is sized for a person browsing a marketplace.
     *
     * It is lifted under test for one reason: every test in the suite arrives
     * from 127.0.0.1, so the whole suite counts as a single very busy visitor,
     * and adding tests eventually starts failing unrelated ones at random. An
     * intermittently red suite is worse than no suite — people stop reading it.
     *
     * Nothing about the limits that actually matter is relaxed. The routes
     * worth attacking — sign-in, password reset, the payout destination —
     * carry their own per-route caps, those are untouched here, and the tests
     * that prove them present as distinct clients rather than being exempted.
     */
    max: config.isTest ? 100_000 : 300,
    timeWindow: "1 minute",
    /*
     * Whatever this returns is *thrown*, not sent — so returning a bare
     * `{ error: … }` payload produced an object with no `statusCode` and no
     * `message`, which the error handler could only classify as an unknown
     * fault. Result: throttled callers got `500 CIAO-5000 "something went
     * wrong on our side"`. Returning a real CiaoError puts it back on the
     * normal path, status and Accept-Language handling included.
     */
    errorResponseBuilder: () => new CiaoError("RATE_LIMITED"),
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
    /*
     * Errors raised by Fastify itself and by plugins — rate limiting, a
     * malformed JSON body, an unsupported content type — are not CiaoErrors,
     * so they used to fall straight through to the branch below. That did two
     * bad things at once: a guest who tapped "send code" twice too quickly was
     * told "something went wrong on our side — support has been notified"
     * instead of "wait a minute", and every one of those was logged at error
     * level, which is where a real incident is supposed to stand out.
     *
     * Anything with a 4xx status is the caller's business and gets the honest
     * status and message.
     */
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const def = status === 429 ? ERRORS.RATE_LIMITED : ERRORS.VALIDATION;
      req.log.warn({ err: String((err as Error)?.message ?? err), status }, "client error");
      return reply
        .status(status)
        .send({ error: { code: def.code, message: locale === "en" ? def.en : def.ar } });
    }
    req.log.error(err);
    const def = ERRORS.INTERNAL;
    return reply
      .status(500)
      .send({ error: { code: def.code, message: locale === "en" ? def.en : def.ar } });
  });

  /*
   * `/health` reports booleans for the settings that fail silently. A CORS
   * origin that doesn't match, a base URL still pointing at localhost, an OTP
   * echo left on — none of these produce an error in any log, and each of
   * them has cost a debugging session. The caller's own Origin is checked
   * against the allowlist so "is my app allowed to talk to you" is answerable
   * with one curl from the affected machine.
   */
  app.get("/health", async (req) => {
    /* Normalised the same way `parseOrigins` normalises the allowlist:
       otherwise "https://x/" reports as blocked while actually being
       allowed, and a health check that lies costs more than none. */
    const origin = String(req.headers.origin ?? "").replace(/\/+$/, "");
    return {
      ok: true,
      service: "ciao-api",
      config: {
        callerOriginAllowed: origin ? config.corsOrigins.includes(origin) : null,
        webBaseUrlIsLocalhost: config.webBaseUrl.includes("localhost"),
        partnerBaseUrlIsLocalhost: config.partnerBaseUrl.includes("localhost"),
        consoleBaseUrlIsLocalhost: config.consoleBaseUrl.includes("localhost"),
        otpDevEcho: config.otp.devEcho,
      },
    };
  });

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
  await app.register(accountRoutes);
  await app.register(partnerRoutes);
  await app.register(partnerAuthRoutes);
  await app.register(partnerCatalogueRoutes);
  await app.register(bizAuthRoutes);
  await app.register(bizMessagingRoutes);
  await app.register(partnerLeadRoutes);
  await app.register(venueRoutes);
  await app.register(waitlistRoutes);
  await app.register(flashOfferRoutes);
  await app.register(mediaRoutes);

  return app;
}
