/** Environment configuration. Railway injects DATABASE_URL / PORT. */

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

/**
 * Split a comma-separated origin list the way a human types it.
 *
 * Exported so it can be tested directly: `config` reads the environment at
 * import time, which makes the whole object awkward to exercise, and this is
 * precisely the part that has already broken a deploy.
 */
export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: req(
    "DATABASE_URL",
    isProd ? undefined : "postgres://ciao:ciao@localhost:5432/ciao",
  ),
  // Signing secrets — set real values in Railway.
  jwtSecret: req("JWT_SECRET", isProd ? undefined : "dev-jwt-secret-change-me"),
  actionTokenSecret: req(
    "ACTION_TOKEN_SECRET",
    isProd ? undefined : "dev-action-secret-change-me",
  ),
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
  /**
   * The partner control panel's own origin.
   *
   * A separate product on its own subdomain, so its links cannot be built from
   * `webBaseUrl` — a set-password link that lands on the consumer site is a
   * partner staring at a marketplace wondering where their business went.
   */
  partnerBaseUrl: process.env.PARTNER_BASE_URL ?? "http://localhost:3002",
  /**
   * The business console's own origin — the third product. Invite links are
   * built from this, so if it points at the wrong app, a new team member's
   * set-password link lands them on a marketplace.
   */
  consoleBaseUrl: process.env.CONSOLE_BASE_URL ?? "http://localhost:3003",
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
  /**
   * Allowed browser origins.
   *
   * Split, then trimmed, then stripped of a trailing slash, because this value
   * is typed into a hosting dashboard by a human under time pressure and the
   * failure mode is silent and total: `@fastify/cors` compares origins by exact
   * string, so one space after a comma — `a, b` — yields `" https://b"`, which
   * matches nothing, and the whole app answers "we couldn't reach the server"
   * with no error anywhere to explain it. An origin has no meaningful trailing
   * slash and no meaningful surrounding whitespace, so accepting both costs
   * nothing and removes a trap that cost us a deploy cycle.
   */
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS ?? "http://localhost:3000"),

  // Payments (§10.2) — Plutu primary; mock provider used until credentials exist.
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "mock",
  plutu: {
    apiKey: process.env.PLUTU_API_KEY ?? "",
    accessToken: process.env.PLUTU_ACCESS_TOKEN ?? "",
    secretKey: process.env.PLUTU_SECRET_KEY ?? "", // HMAC-SHA256 callback verification
    baseUrl: process.env.PLUTU_BASE_URL ?? "https://api.plutu.ly/v1",
  },

  // Messaging (§13.5) — console provider by default; swap via env.
  messagingProvider: process.env.MESSAGING_PROVIDER ?? "console",
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    /**
     * Send Meta-approved template messages (default) rather than free-form
     * text. Free-form only reaches people who wrote to us within 24 hours,
     * and everything Ciao initiates — codes, confirmations, invites — arrives
     * outside that window, so with this off almost nothing would deliver.
     * The off switch exists for testing inside an open 24h session.
     */
    templateSends: process.env.WHATSAPP_TEMPLATE_SENDS !== "false",
  },
  sms: {
    twilioSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    senderId: process.env.SMS_SENDER_ID ?? "CIAO", // alphanumeric, one-way in Libya
  },

  otp: {
    // Demo/dev: echo OTP codes in the API response so they show on the login
    // screen. OTP_DEV_ECHO=true enables this even in production (demo phase —
    // MUST be removed before real users); defaults on outside production.
    devEcho:
      process.env.OTP_DEV_ECHO === "true" ||
      (process.env.OTP_DEV_ECHO !== "false" && !isProd),
    ttlSeconds: 300,
    maxAttempts: 5,
  },

  worker: {
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 5000),
  },
} as const;
