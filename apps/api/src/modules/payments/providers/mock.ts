/**
 * Mock provider for dev/staging and Phase A concierge testing.
 * Simulates the full lifecycle including webhook callbacks:
 * - phone ending in 00 → payment fails
 * - phone ending in 99 → rail down (throws)
 * - otherwise → redirect URL that "pays" via the dev-complete endpoint
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  InitiateParams,
  InitiateResult,
  PaymentProvider,
  ProviderStatus,
  RefundResult,
  WebhookVerification,
} from "../provider.js";
import { config } from "../../../config.js";

const store = new Map<string, { amount: number; status: ProviderStatus["status"] }>();

export const MOCK_SECRET = "mock-webhook-secret";

export function signMockWebhook(body: string): string {
  return createHmac("sha256", MOCK_SECRET).update(body).digest("hex");
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  rails: ["sadad", "adfali", "local_card", "mpgs", "tlync"],

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    if (p.customerPhone.endsWith("99")) {
      throw new Error("MOCK_RAIL_DOWN");
    }
    const ref = `mock_${p.invoiceNo}`;
    store.set(ref, { amount: p.amount, status: "pending" });
    if (p.rail === "sadad") {
      return { providerRef: ref, kind: "otp_confirm", otpRequestId: ref };
    }
    return {
      providerRef: ref,
      kind: "redirect",
      redirectUrl: `${config.apiBaseUrl}/v1/payments/mock/checkout?ref=${encodeURIComponent(ref)}&return=${encodeURIComponent(p.returnUrl)}`,
    };
  },

  async confirmOtp(ref: string, otp: string): Promise<ProviderStatus> {
    const rec = store.get(ref);
    if (!rec) return { providerRef: ref, status: "failed" };
    const ok = otp === "123456"; // dev OTP
    rec.status = ok ? "captured" : "failed";
    return { providerRef: ref, status: rec.status };
  },

  async status(ref: string): Promise<ProviderStatus> {
    return { providerRef: ref, status: store.get(ref)?.status ?? "pending" };
  },

  async refund(ref: string): Promise<RefundResult> {
    const rec = store.get(ref);
    if (rec) rec.status = "refunded";
    return { supported: true, status: "completed", providerRef: ref };
  },

  verifyWebhook(headers, rawBody): WebhookVerification {
    const sig = String(headers["x-signature"] ?? "");
    const expected = signMockWebhook(rawBody);
    let valid = false;
    try {
      valid = sig.length > 0 && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      valid = false;
    }
    const parsed = JSON.parse(rawBody) as {
      event: WebhookVerification["event"];
      invoice_no: string;
      transaction_id: string;
      amount: number;
    };
    return {
      valid,
      externalId: parsed.transaction_id,
      invoiceNo: parsed.invoice_no,
      event: parsed.event,
      amount: parsed.amount,
      raw: parsed,
    };
  },

  /** test helper */
  _capture(ref: string) {
    const rec = store.get(ref);
    if (rec) rec.status = "captured";
  },
} as PaymentProvider & { _capture(ref: string): void };
