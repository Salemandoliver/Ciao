/**
 * PaymentProvider abstraction — §13.4.
 * Rails are hot-swappable config, not code. Providers implement:
 * initiate / status / refund / verifyWebhook.
 */
import type { PaymentRail } from "@ciao/shared";

export interface InitiateParams {
  invoiceNo: string; // unique per booking attempt (§10.2)
  amount: number; // dirhams
  rail: PaymentRail;
  customerPhone: string;
  returnUrl: string;
  metadata?: Record<string, string>;
  /** Sadad OTP flow params (§10.2) */
  sadad?: { mobile: string; birthYear: string };
}

export interface InitiateResult {
  providerRef: string;
  /** Redirect (hosted checkout) or OTP-confirm flow */
  kind: "redirect" | "otp_confirm" | "instant";
  redirectUrl?: string;
  otpRequestId?: string;
}

export interface ProviderStatus {
  providerRef: string;
  status: "pending" | "captured" | "failed" | "expired" | "refunded";
  raw?: unknown;
}

export interface RefundResult {
  supported: boolean;
  status?: "pending" | "completed" | "failed";
  providerRef?: string;
}

export interface WebhookVerification {
  valid: boolean;
  externalId: string;
  invoiceNo?: string;
  event?: "payment.completed" | "payment.failed" | "payment.expired" | "payment.refunded";
  amount?: number;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  readonly rails: PaymentRail[];
  initiate(params: InitiateParams): Promise<InitiateResult>;
  confirmOtp?(otpRequestId: string, otp: string): Promise<ProviderStatus>;
  status(providerRef: string): Promise<ProviderStatus>;
  refund(providerRef: string, amount: number): Promise<RefundResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerification;
}
