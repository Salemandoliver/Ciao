/** Environment configuration. Railway injects DATABASE_URL / PORT. */

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
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
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),

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
  },
  sms: {
    twilioSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    senderId: process.env.SMS_SENDER_ID ?? "CIAO", // alphanumeric, one-way in Libya
  },

  otp: {
    // In dev, OTP codes are logged to console; in prod they go via messaging ladder.
    devEcho: process.env.OTP_DEV_ECHO !== "false" && !isProd,
    ttlSeconds: 300,
    maxAttempts: 5,
  },

  worker: {
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 5000),
  },
} as const;
