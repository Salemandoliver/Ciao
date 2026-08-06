/** Environment configuration. Railway injects DATABASE_URL / PORT. */

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
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
  /*
   * Parsed defensively because the failure is silent and absolute:
   * `@fastify/cors` compares origins by exact string, so `a, b` yields
   * `" https://b"`, matches nothing, logs nothing — and the browser reports
   * only "we couldn't reach the server". Trim each entry, drop the trailing
   * slash a person naturally pastes from an address bar, and drop empties
   * from a trailing comma.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean),

  /**
   * Object storage for photographs (Cloudflare R2, via the S3 API).
   *
   * Absent by default and absent is a supported state: the console keeps the
   * older add-by-path workflow and tells the operator which variables are
   * missing, rather than offering an upload button that throws. See
   * `modules/media/storage.ts`.
   *
   * `publicBaseUrl` is separate from the credentials because it changes on a
   * different schedule — it starts as an `r2.dev` address and becomes
   * `img.ciao.ly` without any secret being touched.
   */
  media: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    bucket: process.env.R2_BUCKET ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
    /** Per-file ceiling. The console re-encodes before upload, so anything
     *  larger than this is a bug or an attack, not a photograph. */
    maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 4_000_000),
  },

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
